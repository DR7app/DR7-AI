import { useState, useEffect, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import { getSpecialPricing, calculateSpecialPrice } from '../../../utils/specialPricing'
import { supabase } from '../../../supabaseClient'

/**
 * Convert EUR string to integer cents using string parsing (no floating point).
 * Handles >2 decimal digits by rounding (e.g. "19.895" → 1990, not 1989).
 * This is the ONLY approved EUR→cents conversion in the reservation flow.
 */
function eurToCents(eur: string | number): number {
  const s = String(eur ?? '0').trim()
  const negative = s.startsWith('-')
  const abs = negative ? s.substring(1) : s
  const dotIdx = abs.indexOf('.')
  let totalCents: number
  if (dotIdx === -1) {
    totalCents = (parseInt(abs, 10) || 0) * 100
  } else {
    const wholePart = parseInt(abs.substring(0, dotIdx), 10) || 0
    const fracStr = abs.substring(dotIdx + 1)
    if (fracStr.length <= 2) {
      // Exact: pad to 2 digits
      const decimalStr = fracStr.padEnd(2, '0')
      totalCents = wholePart * 100 + (parseInt(decimalStr, 10) || 0)
    } else {
      // >2 decimals: use first 3 digits to round properly
      // e.g. "19.895" → first3 = "895" → 895 → Math.round(895/10) = 90 → 1990
      const first3 = fracStr.substring(0, 3).padEnd(3, '0')
      const millis = parseInt(first3, 10) || 0
      totalCents = wholePart * 100 + Math.round(millis / 10)
    }
  }
  return negative ? -totalCents : totalCents
}

/** Convert integer cents to EUR string with exactly 2 decimal places (no floating point) */
function centsToEurStr(cents: number): string {
  const rounded = Math.round(cents)
  const negative = rounded < 0
  const abs = Math.abs(rounded)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  return (negative ? '-' : '') + whole + '.' + String(frac).padStart(2, '0')
}
import { useAdminRole } from '../../../hooks/useAdminRole'
// bookingConflictUtils imports removed - admin can select any time
import { validateRentalBooking } from '../../../utils/schedulingRules'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildBookingContext } from '../../../utils/adminLogHelpers'

import {
  getAvailableVehicles,
  isVehicleAvailable
} from '../../../utils/vehicleAvailability'
import Input from './Input'
import Select from './Select'
import AddressAutocomplete from './AddressAutocomplete'
import Button from './Button'
import CustomerAutocomplete from './CustomerAutocomplete'
import NewClientModal from './NewClientModal'
import MissingFieldsModal from '../../../components/MissingFieldsModal'
import PenaltyModal from './PenaltyModal'
import DanniModal from './DanniModal'
import DanniPenaliModal from './DanniPenaliModal'
import LimitationOverrideModal from '../../../components/LimitationOverrideModal'
import { useLimitationOverride } from '../../../hooks/useLimitationOverride'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'
import { decodificaCodiceFiscale } from '../../../utils/codiceFiscale'
import CalcolaCFButton from '../../../components/CalcolaCFButton'
import {
  classifyDriverTier,
  calculateAge,
  calculateLicenseYears,
  EXPERIENCE_SERVICES,
  getExperienceServicesForTier,
  type DriverTier,
  type TierClassification,
} from '../../../utils/tierClassification'
import { useRentalConfig } from '../../../hooks/useRentalConfig'
import { buildConfigOverlay, getVehicleSforoOverride } from '../../../utils/configOverlay'
import { getKmIncluded, getUnlimitedKmPrice as getUnlimitedKmPriceFromConfig, getInsuranceOptions as getInsuranceOptionsFromConfig } from '../../../utils/configLookup'

// --- Kasko Constants & Types ---
type KaskoTier = 'RCA' | 'KASKO_BASE' | 'KASKO_BLACK' | 'KASKO_SIGNATURE' | 'DR7';

// All insurance options, deposits, pricing now read from Centralina Pro config
// No hardcoded fallback arrays

// eslint-disable-next-line react-refresh/only-export-components
export const INSURANCE_ELIGIBILITY = {
  RCA: { minAge: 18, minLicenseYears: 2 },
  KASKO_BASE: { minAge: 20, minLicenseYears: 2 },
  KASKO_BLACK: { minAge: 25, minLicenseYears: 5 },
  KASKO_SIGNATURE: { minAge: 30, minLicenseYears: 10 },
  DR7: { minAge: 25, minLicenseYears: 3 },
};

// eslint-disable-next-line react-refresh/only-export-components
export const URBAN_INSURANCE_ELIGIBILITY = {
  KASKO_BASE: { minAge: 18, minLicenseYears: 3 },
  KASKO_BLACK: { minAge: 25, minLicenseYears: 5 },
  KASKO_SIGNATURE: { minAge: 30, minLicenseYears: 10 },
  DR7: { minAge: 21, minLicenseYears: 2 },
};

// Generate time options for 15-minute intervals
// eslint-disable-next-line react-refresh/only-export-components
export const TIME_OPTIONS = Array.from({ length: 96 }).map((_, i) => {
  const hour = Math.floor(i / 4).toString().padStart(2, '0')
  const minute = ((i % 4) * 15).toString().padStart(2, '0')
  const time = `${hour}:${minute}`
  return { value: time, label: time }
})

// Rental schedule (per-kind) used to flag out-of-hours slots in the booking
// form. Admin can still pick any slot — flagged ones just get a loud label
// + red styling so the choice is deliberate.
//   PICKUP  Mon-Fri: 10:30-12:30 / 16:30-18:30
//   PICKUP  Sat:     10:30-16:30
//   RETURN  Mon-Fri: 09:00-11:00 / 15:00-17:00
//   RETURN  Sat:     09:00-15:00
const PICKUP_HOURS_WEEKDAY: [number, number][] = [[10*60+30, 12*60+30], [16*60+30, 18*60+30]]
const PICKUP_HOURS_SATURDAY: [number, number][] = [[10*60+30, 16*60+30]]
const RETURN_HOURS_WEEKDAY: [number, number][] = [[9*60, 11*60], [15*60, 17*60]]
const RETURN_HOURS_SATURDAY: [number, number][] = [[9*60, 15*60]]

function rentalHoursFor(dateStr: string | undefined, kind: 'pickup' | 'return'): [number, number][] | null {
  const weekday = kind === 'return' ? RETURN_HOURS_WEEKDAY : PICKUP_HOURS_WEEKDAY
  const saturday = kind === 'return' ? RETURN_HOURS_SATURDAY : PICKUP_HOURS_SATURDAY
  if (!dateStr) return weekday
  const [y, mo, d] = dateStr.split('-').map(Number)
  if (!y || !mo || !d) return weekday
  const dow = new Date(y, mo - 1, d).getDay()
  if (dow === 0) return null               // Sunday — closed
  if (dow === 6) return saturday
  return weekday
}

function isInRentalHours(dateStr: string | undefined, time: string, kind: 'pickup' | 'return'): boolean {
  const ranges = rentalHoursFor(dateStr, kind)
  if (!ranges) return false
  const [h, m] = time.split(':').map(Number)
  const total = (h || 0) * 60 + (m || 0)
  return ranges.some(([a, b]) => total >= a && total <= b)
}

const FLAGGED_TIME_STYLE: React.CSSProperties = { color: 'white', backgroundColor: '#dc2626', fontWeight: 600 }
const NORMAL_TIME_STYLE: React.CSSProperties = { color: 'black', backgroundColor: 'white' }

// eslint-disable-next-line react-refresh/only-export-components
export function buildRentalTimeOptions(dateStr: string | undefined, kind: 'pickup' | 'return') {
  return TIME_OPTIONS.map(o => {
    const ok = isInRentalHours(dateStr, o.value, kind)
    return {
      value: o.value,
      label: ok ? o.value : `🔴 ${o.value}  FUORI ORARIO`,
      style: ok ? NORMAL_TIME_STYLE : FLAGGED_TIME_STYLE,
      flagged: !ok,
    }
  })
}

// Vehicle category is now read from DB (exotic/urban/aziendali) — no name-based detection needed

// Sforo defaults — now read from Centralina Pro config via configOverlay.sforoDefaults
// These are kept as fallback only if config is empty
// eslint-disable-next-line react-refresh/only-export-components
// Rimossi SFORO_DEFAULTS e DEFAULT_SFORO: sforo ora SEMPRE da Centralina Pro.
// Se manca in Centralina, campo vuoto (admin compila Centralina).
const DEFAULT_KM_LIMIT = '100'
// LAVAGGIO_FEE now driven by configOverlay.lavaggioFee

/** Calculate total experience services cost */
function calculateExperienceCost(services: Record<string, number>, rentalDays: number): number {
  let total = 0
  for (const [svcId, qty] of Object.entries(services)) {
    if (qty <= 0) continue
    const svc = EXPERIENCE_SERVICES.find(s => s.id === svcId)
    if (!svc) continue
    if (svc.unit === 'per_day') {
      total += svc.price * rentalDays * qty
    } else {
      total += svc.price * qty
    }
  }
  return Math.round(total * 100) / 100
}

// Lookup sforo SOLO da Centralina Pro (rental_config.sforo_km).
// Nessun fallback hardcoded: se Centralina non ha un valore per la
// categoria del veicolo, ritorna '' e l'admin vede il campo vuoto →
// invito a configurare Centralina invece di usare un numero inventato.
function getSforoForCategory(
  vehicle: Vehicle | undefined,
  rentalConfig: import('../../../types/rentalConfig').RentalConfig | null,
): string {
  if (!rentalConfig?.sforo_km) return ''
  // 1) categoria del veicolo (exotic/urban/aziendali)
  if (vehicle?.category) {
    const catSforo = rentalConfig.sforo_km.category?.[vehicle.category]
    if (catSforo != null) return String(catSforo)
  }
  // 2) global (_global) da Centralina
  const g = rentalConfig.sforo_km._global
  if (g != null) return String(g)
  return ''
}


// Helper function to get insurance options for vehicle + tier
// Reads from Centralina Pro config via configLookup, falls back to overlay
function getInsuranceOptions(vehicle?: Vehicle, tier?: DriverTier, overlay?: ReturnType<typeof buildConfigOverlay>, config?: import('../../../types/rentalConfig').RentalConfig | null) {
  if (!vehicle) {
    const t2 = overlay?.insuranceTier2 || []
    const t1 = overlay?.insuranceTier1 || []
    return tier === 'TIER_2' ? t2 : t1
  }

  const category = vehicle.category || 'exotic'
  const driverTier = (tier || 'TIER_2') as import('../../../types/rentalConfig').DriverTier

  // Read from Centralina Pro config
  if (config) {
    const opts = getInsuranceOptionsFromConfig(config, category, driverTier)
    if (opts.length > 0) {
      return opts.map(o => ({ id: o.id, label: o.name, pricePerDay: o.daily_price }))
    }
  }

  // Fallback to overlay (no hardcoded values)
  if (category === 'urban') return overlay?.urbanInsurance || []
  if (category === 'aziendali') return overlay?.utilitaireInsurance || []
  return tier === 'TIER_2' ? (overlay?.insuranceTier2 || []) : (overlay?.insuranceTier1 || [])
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
  scadenza_patente?: string | null
}

interface Vehicle {
  id: string
  display_name: string
  plate: string | null
  targa?: string | null
  status: 'available' | 'rented' | 'maintenance' | 'retired'
  daily_rate: number
  category?: 'exotic' | 'urban' | 'aziendali'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details: Record<string, any> | null
  booked_at: string
  created_at: string
  updated_at: string
  // Car wash specific fields
  service_type?: string
  service_name?: string
  appointment_date?: string
  appointment_time?: string
  deposit_amount?: number | null
  contract_url?: string
  km_overage_fee?: number
  amount_paid?: number
  // Home delivery & pickup
  delivery_enabled?: boolean
  delivery_address?: { street: string; city: string; zip: string; province: string; notes: string } | null
  delivery_fee?: number
  pickup_enabled?: boolean
  pickup_address?: { street: string; city: string; zip: string; province: string; notes: string } | null
  pickup_fee?: number
  notes?: string | null
  contracts?: {
    signed_pdf_url: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isBookingForVehicle = (booking: any, vehicle: Vehicle) => {
  // First try vehicle_id (most reliable) - check both top-level and booking_details
  const bookingVehicleId = booking.vehicle_id || booking.booking_details?.vehicle_id
  if (bookingVehicleId && bookingVehicleId === vehicle.id) {
    logger.log(`[isBookingForVehicle] MATCH by vehicle_id: ${bookingVehicleId}`)
    return true
  }

  // Try matching by plate - check both top-level and booking_details
  const bookingPlate = booking.vehicle_plate || booking.booking_details?.vehicle_plate
  const vehiclePlate = vehicle.plate || vehicle.targa

  if (bookingPlate && vehiclePlate) {
    if (normalizePlate(bookingPlate) === normalizePlate(vehiclePlate)) {
      logger.log(`[isBookingForVehicle] MATCH by plate: ${normalizePlate(bookingPlate)}`)
      return true
    }
  }

  // NO FALLBACK TO NAME MATCHING - this is forbidden
  // Log warning if we can't match
  if (!bookingVehicleId && !bookingPlate) {
    logger.warn('[Vehicle Matching] Cannot match booking - no vehicle_id or plate:', booking.id)
  }

  return false
}

function CustomerStatusBadge({ email, statusMap }: { email?: string | null; statusMap: Map<string, string> }) {
  if (!email) return null
  const status = statusMap.get(email.toLowerCase())
  if (!status || status === 'standard') return null
  const labels: Record<string, { text: string; cls: string }> = {
    elite: { text: 'ELT', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/50' },
    member: { text: 'MEM', cls: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
    blacklist: { text: 'BL', cls: 'bg-red-500/20 text-red-400 border-red-500/50' },
  }
  const badge = labels[status]
  if (!badge) return null
  return <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold border ${badge.cls}`}>{badge.text}</span>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ReservationsTab({ initialData, onDataConsumed }: { initialData?: { vehicleId?: string; pickupDate?: Date; bookingId?: string; fromPreventivo?: Record<string, any> } | null; onDataConsumed?: () => void }) {
  const { canViewFinancials } = useAdminRole()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [carWashBookings, setCarWashBookings] = useState<Booking[]>([]) // Car wash & mechanical bookings for availability checking
  const [customerStatuses, setCustomerStatuses] = useState<Map<string, string>>(new Map()) // email → status_cliente
  const [clubMembers, setClubMembers] = useState<Set<string>>(new Set()) // user_ids with active DR7 Club
  const [clubEmails, setClubEmails] = useState<Set<string>>(new Set()) // emails with active DR7 Club

  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingOriginalPaymentStatus, setEditingOriginalPaymentStatus] = useState<string | null>(null) // Track if payment changed from unpaid → paid
  const [showAllVehicles, setShowAllVehicles] = useState(false) // Admin override to show all vehicles

  // Limitation Override (OTP-based director approval)
  const {
    limitationState,
    requestOverride,
    handleOverrideApproved,
    closeLimitation,
    cancelLimitation,
    hasOverride,
    consumeAllOverrides,
    activeOverrides,
    draftSessionId,
    flowType,
    newSession,
    getOverrideAuditSnapshot,
  } = useLimitationOverride()

  // Missing Data Modal State
  const [showMissingDataModal, setShowMissingDataModal] = useState(false)
  const [missingFields, setMissingFields] = useState<string[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tempCustomerData, setTempCustomerData] = useState<any>(null)
  const [currentValidationBooking, setCurrentValidationBooking] = useState<Booking | null>(null)
  const [validationContext, setValidationContext] = useState<'contract' | 'invoice' | 'booking'>('contract')


  // Delete Confirmation Modal State

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [generatingContract, setGeneratingContract] = useState(false)
  // Pre-auth disabled — Nexi capture not supported via Pay by Link API

  const isInitialEditLoad = useRef(false)
  // Contatore di richieste per la classificazione Fascia: impedisce alle fetch
  // lente di sovrascrivere il tier del cliente attualmente selezionato.
  const customerTierRequestRef = useRef(0)
  const [generatingInvoice, setGeneratingInvoice] = useState(false)
  const [newSecondDriverMode, setNewSecondDriverMode] = useState(false)
  const [newGaranteMode, setNewGaranteMode] = useState(false)
  const [targaLoading, setTargaLoading] = useState(false)

  // Extend Booking Modal State
  const [showExtendModal, setShowExtendModal] = useState(false)
  const [extendingBooking, setExtendingBooking] = useState<Booking | null>(null)
  const [extendData, setExtendData] = useState({
    new_return_date: '',
    new_return_time: '10:00',
    additional_amount: '0',
    extension_payment_status: 'pending' as 'paid' | 'pending' | 'nexi_pay_by_link',
    extension_payment_method: '',
    link_expiration_hours: '1',
    notes: '',
    change_vehicle: false,
    new_vehicle_id: '',
    show_all_vehicles: false,
    extension_km_added: '',
    extension_unlimited_km: false
  })
  const [isExtending, setIsExtending] = useState(false)

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
    status: 'pending',
    source: 'admin',
    total_amount: '0',
    amount_paid: '0',
    payment_status: 'unpaid',
    payment_method: 'Nexi Pay by Link',
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
    deposit_status: 'da_incassare' as 'da_incassare' | 'incassata' | 'no_cauzione',
    // Canonical id of the Centralina Pro option chosen by the admin. Drives
    // the deposit amount + per-day surcharge that go into the booking total.
    deposit_option_id: '' as string,
    // KM Overage Fee
    km_overage_fee: '', // si popola da Centralina quando si seleziona il veicolo
    unlimited_km: false,
    km_limit: DEFAULT_KM_LIMIT, // Default KM limit when not unlimited
    // Home Delivery & Pickup
    delivery_enabled: false,
    delivery_street: '',
    delivery_city: '',
    delivery_zip: '',
    delivery_province: '',
    delivery_notes: '',
    delivery_fee: '0',
    pickup_enabled: false,
    pickup_street: '',
    pickup_city: '',
    pickup_zip: '',
    pickup_province: '',
    pickup_notes: '',
    pickup_fee: '0',
    notes: '',
    // Experience Services & DR7 Flex
    experience_services: {} as Record<string, number>,
    dr7_flex: false,
    // Cauzione Auto (Vehicle as Security Deposit)
    cauzione_auto: false,
    cauzione_targa: '',
    cauzione_targa_year: '',
    cauzione_targa_brand: '',
    cauzione_targa_model: '',
    cauzione_proprietario_tipo: 'guidatore' as 'guidatore' | 'diverso',
    garante_customer_id: '',
    garante_nome: '',
    garante_cognome: '',
    garante_codice_fiscale: '',
    garante_sesso: '',
    garante_indirizzo: '',
    garante_cap: '',
    garante_citta: '',
    garante_provincia: '',
    garante_birth_date: '',
    garante_birth_place: '',
    garante_birth_provincia: '',
    garante_phone: '',
    garante_email: '',
  })

  // Revenue Management — dynamic price suggestion (uses PricingTrace from backend)
  const [revenueSuggestion, setRevenueSuggestion] = useState<{
    finalTotalEur: number; finalDailyRateEur: number; rentalDays: number
    selectedBaseRateEur: number; selectedBaseRateSource: string
    breakdown: { label: string; coeff: number; description: string }[]
    occupancyPct: number; mode: string; enabled: boolean
    minHit: boolean; maxHit: boolean
    minPrice?: number | null; maxPrice?: number | null
    vehicleName: string; category: string
  } | null>(null)
  const [revenueLoading, setRevenueLoading] = useState(false)
  const [revenueExpanded, setRevenueExpanded] = useState(false)

  // --- Driver Tier Classification ---
  const [customerTier, setCustomerTier] = useState<TierClassification | null>(null)

  // --- Centralina Config Overlay ---
  // Loads pricing from Supabase config. Falls back to hardcoded defaults.
  const { config: rentalConfig } = useRentalConfig()
  const configOverlay = useMemo(() => buildConfigOverlay(rentalConfig), [rentalConfig])

  // ── Centralina Pro live read for No-Cauzione surcharge ────────────────
  // Mirrors the lookup added to PreventiviTab. Reads
  //   centralina_pro_config.deposits[category][fascia][residente|non_residente]
  // matches a "Nessuna cauzione" option by id OR by label, and falls back
  // to configOverlay.noCauzionePerDay if Pro doesn't have it set. Subscribes
  // to realtime updates so a price edit in CentralinaProTab live-updates
  // the booking form without a reload.
  const SARDEGNA_PROVINCES = useMemo(() => new Set(['CA', 'NU', 'OR', 'SS', 'SU', 'OG', 'OT', 'CI', 'VS']), [])

  const [customerProvincia, setCustomerProvincia] = useState<string>('')
  useEffect(() => {
    if (!formData.customer_id) {
      setCustomerProvincia('')
      return
    }
    let cancelled = false
    fetch(`/.netlify/functions/get-customer?id=${formData.customer_id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return
        const cust = data?.customer
        const prov = String(cust?.provincia_residenza || cust?.provincia || '').toUpperCase().trim()
        setCustomerProvincia(prov)
      })
      .catch(() => { if (!cancelled) setCustomerProvincia('') })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.customer_id])

  // Default to "residente" if no provincia is known yet — matches PreventiviTab default.
  const isResidenteSardegna = customerProvincia ? SARDEGNA_PROVINCES.has(customerProvincia) : true

  const [proDeposits, setProDeposits] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      if (cancelled) return
      const cfg = (data?.config as { deposits?: Record<string, unknown> } | undefined) || {}
      setProDeposits(cfg.deposits || null)
    })()
    const channel = supabase
      .channel('reservations-deposits')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' }, (payload) => {
        const cfg = (payload.new as { config?: { deposits?: Record<string, unknown> } } | undefined)?.config
        if (cfg && typeof cfg === 'object') setProDeposits(cfg.deposits || null)
      })
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Full list of cauzione options for the current (vehicle category × fascia × residenza)
  // pulled live from Centralina Pro. Drives the new "Opzione Cauzione" dropdown
  // so the admin sees the exact options Preventivi/Centralina knows about
  // — no more typing the amount blind.
  type ProDepositOption = { id?: string; label?: string; amount?: number | string; surcharge_per_day?: number | string }
  const isNoDepositOpt = (o: ProDepositOption) => {
    if (o.id === 'no_deposit') return true
    const label = String(o.label || '').toLowerCase().trim()
    return /nessuna\s+cauzione|no\s+cauzione|^no_deposit$/i.test(label)
  }

  const depositOptionsForCurrentBooking = useMemo<ProDepositOption[]>(() => {
    if (!proDeposits) return []
    const firstVal = Object.values(proDeposits)[0] as Record<string, unknown> | undefined
    const isOld = !!firstVal && typeof firstVal === 'object'
      && ('residente' in firstVal || 'non_residente' in firstVal)

    const selectedVeh = vehicles.find(v => v.id === formData.vehicle_id)
    const vehCat = String(selectedVeh?.category || '').toLowerCase().trim()
    const proCategory = vehCat === 'supercar' || vehCat === 'supercars' || vehCat === 'exotic'
      ? 'supercars'
      : vehCat === 'furgone' || vehCat === 'furgoni' || vehCat === 'aziendali' || vehCat === 'ncc'
      ? 'aziendali'
      : 'urban'

    const fasciaKey = customerTier?.tier === 'TIER_1' ? 'B' : 'A'
    const residencyKey = isResidenteSardegna ? 'residente' : 'non_residente'

    if (isOld) {
      const fasciaCfg = (proDeposits[fasciaKey] as { residente?: unknown; non_residente?: unknown } | undefined)
      return ((fasciaCfg?.[residencyKey] as ProDepositOption[]) || [])
    }

    const catCfg = proDeposits[proCategory] as Record<string, { residente?: unknown; non_residente?: unknown }> | undefined
    const fasciaCfg = catCfg?.[fasciaKey]
    const ownOpts = ((fasciaCfg?.[residencyKey] as ProDepositOption[]) || []).slice()

    // Fallback: if THIS category doesn't have a "Nessuna cauzione" entry, look
    // in the other categories for the same fascia × residency combo and pull
    // it in. The operator only needs to configure the option once, in any
    // category, and it stays available across the whole admin.
    if (!ownOpts.some(isNoDepositOpt)) {
      const otherCats = (['supercars', 'aziendali', 'urban'] as const).filter(c => c !== proCategory)
      for (const c of otherCats) {
        const otherCatCfg = proDeposits[c] as Record<string, { residente?: unknown; non_residente?: unknown }> | undefined
        const otherFasciaCfg = otherCatCfg?.[fasciaKey]
        const otherOpts = (otherFasciaCfg?.[residencyKey] as ProDepositOption[]) || []
        const noDep = otherOpts.find(isNoDepositOpt)
        if (noDep) {
          ownOpts.push(noDep)
          break
        }
      }
    }

    return ownOpts
  }, [proDeposits, vehicles, formData.vehicle_id, customerTier, isResidenteSardegna])

  const noCauzioneResolvedDaily = useMemo(() => {
    const fallback = configOverlay.noCauzionePerDay || 0
    const fromPro = depositOptionsForCurrentBooking.find(isNoDepositOpt)?.surcharge_per_day
    const num = Number(fromPro)
    if (Number.isFinite(num) && num > 0) return num
    return fallback
  }, [depositOptionsForCurrentBooking, configOverlay.noCauzionePerDay])

  // Currently-selected option (from formData.deposit_option_id). Drives the
  // surcharge_per_day applied to the booking total — replaces the previous
  // "only fire when status=no_cauzione" behaviour.
  const selectedDepositOption = useMemo<ProDepositOption | null>(() => {
    const id = formData.deposit_option_id
    if (!id) return null
    return depositOptionsForCurrentBooking.find(o => o.id === id) || null
  }, [depositOptionsForCurrentBooking, formData.deposit_option_id])

  const selectedDepositSurchargePerDay = useMemo(() => {
    const v = Number(selectedDepositOption?.surcharge_per_day)
    return Number.isFinite(v) && v > 0 ? v : 0
  }, [selectedDepositOption])

  // Config-driven price aliases (used throughout the form instead of hardcoded constants)
  const CFG_LAVAGGIO_FEE = configOverlay.lavaggioFee
  // Bound to the live Pro-resolved daily so edits in CentralinaProTab flow through.
  const CFG_NO_CAUZIONE_PER_DAY = noCauzioneResolvedDaily
  const CFG_UNLIMITED_KM = { TIER_1: configOverlay.unlimitedKmTier1, TIER_2: configOverlay.unlimitedKmTier2 }
  // Unlimited KM prices — read from Centralina Pro config by vehicle category.
  // Quando tier è sconosciuto (customer senza data_nascita/patente → classifier
  // non può determinare Fascia), preferisci TIER_1 (Fascia B, prezzo maggiore).
  // Meglio sovra-quotare che sotto-quotare: se poi il cliente risulta Fascia A,
  // customerTier si classifica correttamente e scende a TIER_2.
  function getUnlimitedKmPriceRes(vehicle?: Vehicle, tier?: string): number {
    if (!vehicle) return tier === 'TIER_2' ? CFG_UNLIMITED_KM.TIER_2 : CFG_UNLIMITED_KM.TIER_1
    const category = vehicle.category || 'exotic'
    if (rentalConfig) {
      // Default TIER_1 (Fascia B, 289 per supercar) quando tier sconosciuto,
      // invece di TIER_2 (Fascia A, 189) — sovra-quota invece di sotto-quotare.
      const t = (tier === 'TIER_1' || tier === 'TIER_2') ? tier : 'TIER_1'
      return getUnlimitedKmPriceFromConfig(rentalConfig, category, t as import('../../../types/rentalConfig').DriverTier)
    }
    return tier === 'TIER_2' ? CFG_UNLIMITED_KM.TIER_2 : CFG_UNLIMITED_KM.TIER_1
  }
  const CFG_SECOND_DRIVER = { TIER_1: configOverlay.secondDriverTier1, TIER_2: configOverlay.secondDriverTier2 }
  const CFG_DR7_FLEX_PER_DAY = configOverlay.dr7FlexPerDay

  // Get daily rate from Centralina Pro tariffe — NO vehicle.daily_rate
  function getDailyRateFromConfig(vehicle: Vehicle | undefined, days: number): number {
    if (!vehicle || !rentalConfig) return 0
    const category = vehicle.category || 'exotic'
    const dayRates = rentalConfig.rental_day_rates?.[category]
    if (!dayRates) return 0
    const table = dayRates.flat || dayRates.resident || dayRates.non_resident
    if (!table) return 0
    const directTotal = table[String(days)]
    if (directTotal) return Math.round(directTotal / days * 100) / 100
    const maxDay = Math.max(...Object.keys(table).map(Number).filter(n => !isNaN(n)))
    if (maxDay > 0 && table[String(maxDay)]) {
      const lastTotal = table[String(maxDay)]
      const avgPerDay = lastTotal / maxDay
      const extraDays = days - maxDay
      return Math.round((lastTotal + extraDays * avgPerDay) / days * 100) / 100
    }
    return 0
  }

  useEffect(() => {
    if (!formData.vehicle_id || !formData.pickup_date || !formData.return_date) {
      setRevenueSuggestion(null)
      return
    }
    const pickup = `${formData.pickup_date}T${formData.pickup_time || '10:00'}`
    const dropoff = `${formData.return_date}T${formData.return_time || '10:00'}`

    let cancelled = false
    setRevenueLoading(true)
    fetch('/.netlify/functions/calculate-dynamic-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: formData.vehicle_id, pickup_date: pickup, dropoff_date: dropoff })
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.enabled && data.finalTotalEur) {
          setRevenueSuggestion(data)
          // Always auto-fill the total amount on new bookings using the dynamic
          // price pipeline (rental + extras × coefficient, clamp, + experience).
          // Mirrors PreventiviTab.pricing useMemo — base alone is wrong because
          // the coefficient must apply to the whole rental subtotal, not just
          // the per-day base.
          if (!editingId) {
            setFormData(prev => {
              const selectedVehicle = vehicles.find(v => v.id === prev.vehicle_id)
              const activeTier = customerTier?.tier
              const kaskoOptions = selectedVehicle ? getInsuranceOptions(selectedVehicle, activeTier, configOverlay, rentalConfig) : []
              const selectedKasko = kaskoOptions.find(k => k.id === prev.insurance_option)
              const insuranceTotal = (selectedKasko?.pricePerDay || 0) * data.rentalDays
              const deliveryFees = (prev.delivery_enabled ? parseFloat(prev.delivery_fee || '0') : 0)
                + (prev.pickup_enabled ? parseFloat(prev.pickup_fee || '0') : 0)
              // Surcharge per day comes from the Pro option the admin picked.
              // For backwards compat, when status='no_cauzione' but no specific
              // option was chosen, fall back to the configured no-cauzione daily.
              const surchargePerDay = selectedDepositSurchargePerDay
                || (prev.deposit_status === 'no_cauzione' ? CFG_NO_CAUZIONE_PER_DAY : 0)
              const noCauzioneSurcharge = surchargePerDay * data.rentalDays
              let unlimitedKmSurcharge = 0
              if (prev.unlimited_km) {
                unlimitedKmSurcharge = getUnlimitedKmPriceRes(selectedVehicle, activeTier) * data.rentalDays
              }
              const secondDriverFee = prev.has_second_driver
                ? (activeTier === 'TIER_2' ? CFG_SECOND_DRIVER.TIER_2 : CFG_SECOND_DRIVER.TIER_1) * data.rentalDays
                : 0
              const experienceCost = calculateExperienceCost(prev.experience_services, data.rentalDays)
              const flexCost = prev.dr7_flex && activeTier === 'TIER_2' ? CFG_DR7_FLEX_PER_DAY * data.rentalDays : 0
              // List price: base rate (no coefficients) × days + all services.
              // Experience services are EXCLUDED from the clamp — the Max €/g
              // from Centralina applies to rental + standard extras only; any
              // bespoke experience add-on is added on top afterwards.
              const listDailyRate = data.selectedBaseRateEur || getDailyRateFromConfig(selectedVehicle, data.rentalDays)
              const listRentalTotal = listDailyRate * data.rentalDays
              const extrasNoExp = insuranceTotal + deliveryFees + CFG_LAVAGGIO_FEE + noCauzioneSurcharge + unlimitedKmSurcharge + secondDriverFee + flexCost
              const listSubtotalNoExp = listRentalTotal + extrasNoExp
              // Combined coefficient from revenue engine
              const combinedCoeff = (data.breakdown || []).reduce((acc: number, b: { coeff: number }) => acc * b.coeff, 1)
              // Clamp the clamp-eligible portion (rental + standard extras)
              // against the per-vehicle daily min/max from Centralina Pro.
              const minDaily = typeof data.minPrice === 'number' ? data.minPrice : null
              const maxDaily = typeof data.maxPrice === 'number' ? data.maxPrice : null
              const maxTotal = maxDaily != null ? maxDaily * data.rentalDays : null
              const minTotal = minDaily != null ? minDaily * data.rentalDays : null
              let afterRevenueNoExp = listSubtotalNoExp * combinedCoeff
              if (maxTotal != null && afterRevenueNoExp > maxTotal) afterRevenueNoExp = maxTotal
              if (minTotal != null && afterRevenueNoExp < minTotal) afterRevenueNoExp = minTotal
              // Experience stays at LIST PRICE — no coefficient, no clamp.
              const subtotal = Math.round((afterRevenueNoExp + experienceCost) * 100) / 100
              const total = prev.payment_method === 'Contanti' ? subtotal * 1.20 : subtotal
              // Auto-calculate KM limit from rental days (only if not unlimited)
              const updates: Record<string, string> = { total_amount: total.toFixed(2) }
              if (!prev.unlimited_km) {
                const vehCategory = selectedVehicle?.category || ''
                const kmCat = vehCategory === 'urban' ? 'urban' : (vehCategory || '_global')
                const kmIncluded = getKmIncluded(rentalConfig, data.rentalDays, kmCat)
                // Only overwrite km_limit when the config returns a real, positive
                // number. If kmIncluded is 0 it means the config is missing/empty for
                // this category — in that case, leave formData.km_limit as-is so the
                // admin's previously-saved value survives a re-render.
                if (kmIncluded !== 'unlimited' && typeof kmIncluded === 'number' && kmIncluded > 0) {
                  updates.km_limit = String(kmIncluded)
                }
              }
              return { ...prev, ...updates }
            })
          }
        } else {
          setRevenueSuggestion(null)
        }
      })
      .catch(() => { if (!cancelled) setRevenueSuggestion(null) })
      .finally(() => { if (!cancelled) setRevenueLoading(false) })

    return () => { cancelled = true }
    // customerTier incluso nei deps: cambiando cliente (Fascia A ↔ B) il totale
    // deve ricalcolarsi perché i prezzi di km-illimitati, secondo guidatore e
    // dr7 flex dipendono dalla fascia.
  }, [formData.vehicle_id, formData.pickup_date, formData.return_date, formData.pickup_time, formData.return_time, customerTier, noCauzioneResolvedDaily])

  // Recalculate total when insurance, delivery fees, or payment method change.
  // Runs in any engine mode — the dynamic coefficient + clamp must always
  // apply to the full subtotal (rental + extras), matching Preventivi.
  useEffect(() => {
    if (revenueSuggestion && formData.vehicle_id) {
      const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)
      const activeTier = customerTier?.tier || 'TIER_1'
      const kaskoOptions = selectedVehicle ? getInsuranceOptions(selectedVehicle, activeTier, configOverlay, rentalConfig) : []
      const selectedKasko = kaskoOptions.find(k => k.id === formData.insurance_option)
      const insuranceTotal = (selectedKasko?.pricePerDay || 0) * revenueSuggestion.rentalDays
      const deliveryFees = (formData.delivery_enabled ? parseFloat(formData.delivery_fee || '0') : 0)
        + (formData.pickup_enabled ? parseFloat(formData.pickup_fee || '0') : 0)
      // Surcharge from the Pro option the admin picked, falling back to the
      // legacy no-cauzione daily for older records.
      const surchargePerDay = selectedDepositSurchargePerDay
        || (formData.deposit_status === 'no_cauzione' ? CFG_NO_CAUZIONE_PER_DAY : 0)
      const noCauzioneSurcharge = surchargePerDay * revenueSuggestion.rentalDays
      let unlimitedKmSurcharge = 0
      if (formData.unlimited_km) {
        unlimitedKmSurcharge = getUnlimitedKmPriceRes(selectedVehicle, activeTier) * revenueSuggestion.rentalDays
      }
      const secondDriverFee = formData.has_second_driver
        ? (activeTier === 'TIER_2' ? CFG_SECOND_DRIVER.TIER_2 : CFG_SECOND_DRIVER.TIER_1) * revenueSuggestion.rentalDays
        : 0
      const experienceCost = calculateExperienceCost(formData.experience_services, revenueSuggestion.rentalDays)
      const flexCost = formData.dr7_flex && activeTier === 'TIER_2' ? CFG_DR7_FLEX_PER_DAY * revenueSuggestion.rentalDays : 0
      // List price: base rate (no coefficients) × days + all services.
      // Experience excluded from the clamp — same rationale as the
      // auto_apply branch above.
      const listDailyRate = revenueSuggestion.selectedBaseRateEur || getDailyRateFromConfig(selectedVehicle, revenueSuggestion.rentalDays)
      const listRentalTotal = listDailyRate * revenueSuggestion.rentalDays
      const extrasNoExp = insuranceTotal + deliveryFees + CFG_LAVAGGIO_FEE + noCauzioneSurcharge + unlimitedKmSurcharge + secondDriverFee + flexCost
      const listSubtotalNoExp = listRentalTotal + extrasNoExp
      const combinedCoeff = (revenueSuggestion.breakdown || []).reduce((acc: number, b: { coeff: number }) => acc * b.coeff, 1)
      const minDaily = typeof revenueSuggestion.minPrice === 'number' ? revenueSuggestion.minPrice : null
      const maxDaily = typeof revenueSuggestion.maxPrice === 'number' ? revenueSuggestion.maxPrice : null
      const maxTotal = maxDaily != null ? maxDaily * revenueSuggestion.rentalDays : null
      const minTotal = minDaily != null ? minDaily * revenueSuggestion.rentalDays : null
      let afterRevenueNoExp = listSubtotalNoExp * combinedCoeff
      if (maxTotal != null && afterRevenueNoExp > maxTotal) afterRevenueNoExp = maxTotal
      if (minTotal != null && afterRevenueNoExp < minTotal) afterRevenueNoExp = minTotal
      // Experience stays at LIST PRICE — no coefficient, no clamp.
      const subtotal = Math.round((afterRevenueNoExp + experienceCost) * 100) / 100
      const newTotal = formData.payment_method === 'Contanti' ? subtotal * 1.20 : subtotal
      const updates: Record<string, string> = { total_amount: newTotal.toFixed(2) }
      // Auto-calculate KM limit from rental days
      if (!formData.unlimited_km) {
        const vehCategory = selectedVehicle?.category || ''
        const kmCat = vehCategory === 'urban' ? 'urban' : (vehCategory || '_global')
        const kmIncluded = getKmIncluded(rentalConfig, revenueSuggestion.rentalDays, kmCat)
        if (kmIncluded !== 'unlimited') {
          updates.km_limit = String(kmIncluded)
        }
      }
      setFormData(prev => ({ ...prev, ...updates }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.insurance_option, formData.delivery_fee, formData.pickup_fee, formData.delivery_enabled, formData.pickup_enabled, formData.payment_method, formData.unlimited_km, formData.deposit_status, formData.deposit_option_id, formData.has_second_driver, formData.experience_services, formData.dr7_flex, customerTier, noCauzioneResolvedDaily, selectedDepositSurchargePerDay])

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

  // Auto-populate garante fields when customer is selected
  useEffect(() => {
    if (formData.garante_customer_id && !newGaranteMode) {
      const fetchGaranteData = async () => {
        const { data: fullCustomer, error } = await supabase
          .from('customers_extended')
          .select('*')
          .eq('id', formData.garante_customer_id)
          .single()

        if (error || !fullCustomer) {
          console.error('Error fetching garante customer data:', error)
          return
        }

        setFormData(prev => ({
          ...prev,
          garante_nome: fullCustomer.nome || '',
          garante_cognome: fullCustomer.cognome || '',
          garante_codice_fiscale: fullCustomer.codice_fiscale || '',
          garante_sesso: fullCustomer.sesso || '',
          garante_indirizzo: fullCustomer.indirizzo || '',
          garante_cap: fullCustomer.codice_postale || fullCustomer.cap || '',
          garante_citta: fullCustomer.citta_residenza || fullCustomer.citta || '',
          garante_provincia: fullCustomer.provincia_residenza || fullCustomer.provincia || '',
          garante_birth_date: fullCustomer.data_nascita || '',
          garante_birth_place: fullCustomer.luogo_nascita || '',
          garante_birth_provincia: fullCustomer.provincia_nascita || '',
          garante_phone: fullCustomer.telefono || '',
          garante_email: fullCustomer.email || '',
        }))
      }
      fetchGaranteData()
    }
  }, [formData.garante_customer_id, newGaranteMode])

  async function handleLookupCauzioneTarga() {
    if (!formData.cauzione_targa || formData.cauzione_targa.length < 5) {
      toast.error('Inserisci una targa valida')
      return
    }
    setTargaLoading(true)
    try {
      const resp = await fetch('/.netlify/functions/lookup-targa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targa: formData.cauzione_targa }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        toast.error(data.error || 'Errore nella ricerca della targa')
        return
      }
      const year = parseInt(data.year)
      if (isNaN(year) || year < 2020) {
        if (!hasOverride('vehicle_year_too_old')) {
          requestOverride('vehicle_year_too_old', `Veicolo immatricolato nel ${data.year || '?'}: deve essere dal 2020 in poi per la cauzione.`)
          setTargaLoading(false)
          return
        }
      }
      setFormData(prev => ({
        ...prev,
        cauzione_targa_brand: data.brand || '',
        cauzione_targa_model: data.model || '',
        cauzione_targa_year: data.year || '',
      }))
      toast.success(`${data.brand} ${data.model} (${data.year}) trovato`)
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error('Errore: ' + _errMsg)
    } finally {
      setTargaLoading(false)
    }
  }

  // Handle initial data from Calendar click
  useEffect(() => {
    if (initialData && vehicles.length > 0) {
      const { vehicleId, pickupDate, bookingId } = initialData

      // If bookingId is provided, load that booking in edit mode
      if (bookingId) {
        const booking = bookings.find(b => b.id === bookingId)
        if (booking) {
          logger.log('📝 Opening booking in edit mode:', bookingId)
          handleEditBooking(booking)
          // Notify parent to clear data
          if (onDataConsumed) onDataConsumed()
          return
        }
      }

      // Handle fromPreventivo: pre-fill form with quote data
      if (initialData.fromPreventivo) {
        const prev = initialData.fromPreventivo
        const vehicle = vehicles.find(v => v.id === prev.vehicle_id)
        if (vehicle) {
          const pickupStr = prev.pickup_date ? new Date(prev.pickup_date).toISOString().split('T')[0] : ''
          const dropoffStr = prev.dropoff_date ? new Date(prev.dropoff_date).toISOString().split('T')[0] : ''
          const pickupTimeStr = prev.pickup_date ? new Date(prev.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' }) : '10:30'
          const returnTimeStr = prev.dropoff_date ? new Date(prev.dropoff_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' }) : '10:00'

          logger.log('📋 Prefilling from preventivo:', prev.preventivoId)

          setFormData(p => ({
            ...p,
            vehicle_id: vehicle.id,
            pickup_date: pickupStr,
            pickup_time: pickupTimeStr,
            return_date: dropoffStr,
            return_time: returnTimeStr,
            category: vehicle.category,
            insurance_option: prev.insurance_option || p.insurance_option,
            unlimited_km: !!prev.unlimited_km,
            deposit_status: prev.no_cauzione ? 'no_cauzione' : p.deposit_status,
            total_amount: prev.total_amount ? String(prev.total_amount) : p.total_amount,
          }))

          newSession('booking_create')
          setShowForm(true)
          if (onDataConsumed) onDataConsumed()
          return
        }
      }

      // Otherwise, create new booking with prefilled data
      // Find vehicle by ID (not by name — names can collide)
      const vehicle = vehicles.find(v => v.id === vehicleId)

      if (vehicle) {
        // Format date as YYYY-MM-DD
        const dateStr = pickupDate ? pickupDate.toISOString().split('T')[0] : ''
        const smartTime = getNext15MinuteTime()

        logger.log('📅 Prefilling booking form:', { vehicle: vehicle.display_name, date: dateStr })

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

        newSession(initialData?.bookingId ? 'booking_edit' : 'booking_create')
        setShowForm(true)

        // Notify parent to clear data
        if (onDataConsumed) onDataConsumed()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    sesso: '' as '' | 'M' | 'F',
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [customerToEdit, setCustomerToEdit] = useState<any>(null)

  // Penalty Modal State
  const [penaltyModalOpen, setPenaltyModalOpen] = useState(false)
  const [selectedBookingForPenalty, setSelectedBookingForPenalty] = useState<Booking | null>(null)

  // Danni Modal State
  const [danniModalOpen, setDanniModalOpen] = useState(false)
  const [selectedBookingForDanni, setSelectedBookingForDanni] = useState<Booking | null>(null)

  // Combined Danni & Penali Modal State
  const [danniPenaliModalOpen, setDanniPenaliModalOpen] = useState(false)
  const [selectedBookingForDanniPenali, setSelectedBookingForDanniPenali] = useState<Booking | null>(null)
  const [danniPenaliInitialTab, setDanniPenaliInitialTab] = useState<'danni' | 'penali'>('danni')

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
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errCode = typeof error === 'object' && error !== null ? String((error as Record<string, any>).code ?? '') : ''
      console.error('Error fetching customer for edit:', error)

      // More helpful error message
      if (errCode === 'PGRST116' || _errMsg?.includes('not found')) {
        alert("Cliente non trovato nel database.\n\nIl cliente potrebbe essere stato creato sul sito web ma non ha ancora un profilo completo nell'admin panel.\n\nContatta il supporto tecnico per risolvere questo problema.")
      } else {
        alert("Impossibile caricare i dati del cliente per la modifica.\n\nErrore: " + (_errMsg || 'Errore sconosciuto'))
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
      logger.log('[Vehicle Availability] No dates selected - showing all vehicles:', vehicles.length)
      return vehicles
    }

    // Use the availability engine to filter vehicles
    const pickupTime = formData.pickup_time || '09:00'
    const returnTime = formData.return_time || '18:00'

    // Combine all bookings for availability checking - ONLY non-cancelled bookings
    const allBookingsForCheck = [...bookings, ...carWashBookings].filter(b => b.status !== 'cancelled')

    logger.log('[Vehicle Availability] Checking availability for:', {
      dates: `${formData.pickup_date} ${pickupTime} → ${formData.return_date} ${returnTime}`,
      totalVehicles: vehicles.length,
      totalBookings: allBookingsForCheck.length
    })

    const filteredVehicles = getAvailableVehicles(
      vehicles,
      formData.pickup_date,
      formData.return_date,
      pickupTime,
      returnTime,
      allBookingsForCheck,
      editingId || undefined
    )

    // Log which vehicles were filtered out and WHY (with actual reason from availability check)
    const filteredOut = vehicles.filter(v => !filteredVehicles.includes(v))
    if (filteredOut.length > 0) {
      logger.log('[Vehicle Availability] ===== FILTERED OUT VEHICLES =====')
      filteredOut.forEach(v => {
        // Get the actual reason from isVehicleAvailable
        const result = isVehicleAvailable(v, formData.pickup_date, formData.return_date, pickupTime, returnTime, allBookingsForCheck, editingId || undefined)
        logger.log(`[FILTERED OUT] ${v.display_name} (${v.plate || v.targa || 'no plate'}): ${result.reason || 'Unknown reason'}`)
      })
      logger.log('[Vehicle Availability] ================================')
    }

    logger.log('[Vehicle Availability] Available:', filteredVehicles.length, 'of', vehicles.length)

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
          logger.log('[Vehicle Dropdown] Adding currently selected vehicle to dropdown:', selectedVehicle.display_name)
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

        logger.log(`[Earliest Time] ${vehicle.display_name}: Conflict ends at ${latestConflictEnd.toLocaleTimeString('it-IT')}, available at ${earliestAvailable.toLocaleTimeString('it-IT')} (after wash)`)
      }
    })

    return times
  }, [vehicles, bookings, carWashBookings, formData.pickup_date, formData.return_date, formData.pickup_time, formData.return_time, editingId])

  // FINAL vehicles for dropdown - trust the availability engine completely
  // The availability engine (vehicleAvailability.ts) handles all conflict detection with proper Rome timezone
  const vehiclesForDropdown = useMemo((): Vehicle[] => {
    // Admin override: show ALL vehicles if checkbox is checked
    if (showAllVehicles) {
      logger.log('[Vehicle Dropdown] ADMIN OVERRIDE: Showing all vehicles:', vehicles.length)
      return vehicles
    }

    // Start with the base vehicles (already filtered by availability engine)
    const result = [...baseVehiclesForDropdown]

    // Add vehicles with same-day returns that have an earliest available time
    // These vehicles are NOT in baseVehiclesForDropdown because they have conflicts,
    // but we want to show them with their earliest available time hint
    if (formData.pickup_date) {
      const sameDayVehicleIds = new Set<string>()

      vehicleEarliestTimes.forEach((earliestTime, vehicleId) => {
        // If vehicle has an earliest time AND is not already in result, it's a same-day return
        if (!result.some(v => v.id === vehicleId)) {
          const vehicle = vehicles.find(v => v.id === vehicleId)
          if (vehicle) {
            // Only add if earliest time is within business hours on the pickup date
            const pickupDateStr = formData.pickup_date
            const earliestDateStr = earliestTime.toISOString().split('T')[0]
            const earliestHour = earliestTime.getHours()

            if (earliestDateStr === pickupDateStr && earliestHour < 19) {
              sameDayVehicleIds.add(vehicleId)
              result.push(vehicle)
              logger.log(`[Vehicle Dropdown] Adding same-day return: ${vehicle.display_name} (${vehicle.plate}) - available from ${earliestTime.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`)
            }
          }
        }
      })
    }

    logger.log('[Vehicle Dropdown] Final list:', result.length, 'vehicles:', result.map(v => v.display_name))

    return result
  }, [baseVehiclesForDropdown, formData.pickup_date, vehicles, vehicleEarliestTimes, showAllVehicles])

  const LOCATIONS = [
    { value: 'dr7_office', label: 'Viale Marconi, 229, 09131 Cagliari CA', fee: 0 },
    { value: 'cagliari_airport', label: 'Aeroporto di Cagliari Elmas (+€50)', fee: 50 },
    { value: 'alghero_airport', label: 'Aeroporto di Alghero (+€50)', fee: 50 },
    { value: 'domicilio', label: 'Consegna a domicilio (inserisci indirizzo)', fee: 0 },
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
      logger.log('[ReservationsTab] Applying special pricing for:', customerName)

      // Calculate special total (includes tiered discounts + noCents rounding)
      const specialTotal = calculateSpecialPrice(specialRule, diffDays)

      setFormData(prev => ({
        ...prev,
        total_amount: specialTotal.toFixed(2),
        // Force options to match website config
        insurance_option: specialRule.includesKasko === 'base' ? 'KASKO_BASE' : prev.insurance_option,
        unlimited_km: specialRule.includesUnlimitedKm,
        km_limit: specialRule.includesUnlimitedKm ? '0' : prev.km_limit,
        deposit: specialRule.noDeposit ? '0' : prev.deposit,
      }))

      return
    }
   
    // Standard Calculation
    // Get vehicle daily rate (convert from cents to euros)
    const vehicleDailyRate = getDailyRateFromConfig(selectedVehicle, diffDays)
   
    // Get Kasko daily cost
    const kaskoOptions = getInsuranceOptions(selectedVehicle, undefined, configOverlay, rentalConfig)
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

  // Auto-apply special pricing for VIP clients (Massimo, Jeanne)
  useEffect(() => {
    if (!formData.customer_id || !formData.pickup_date || !formData.return_date) return

    const customerName = customers.find(c => c.id === formData.customer_id)?.full_name
    const specialRule = getSpecialPricing(customerName)
    if (!specialRule) return

    const pickupDate = new Date(formData.pickup_date)
    const returnDate = new Date(formData.return_date)
    const diffTime = Math.abs(returnDate.getTime() - pickupDate.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    if (diffDays <= 0) return

    const specialTotal = calculateSpecialPrice(specialRule, diffDays)

    setFormData(prev => ({
      ...prev,
      total_amount: specialTotal.toFixed(2),
      insurance_option: specialRule.includesKasko === 'base' ? 'KASKO_BASE' as KaskoTier : prev.insurance_option,
      unlimited_km: specialRule.includesUnlimitedKm,
      km_limit: specialRule.includesUnlimitedKm ? '0' : prev.km_limit,
      deposit: specialRule.noDeposit ? '0' : prev.deposit,
    }))
  }, [formData.customer_id, formData.pickup_date, formData.return_date, customers])

  // Reset insurance option when vehicle or tier changes
  useEffect(() => {
    if (formData.vehicle_id) {
      const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)
      if (!selectedVehicle) return;

      const activeTier = customerTier?.tier
      const availableOptions = getInsuranceOptions(selectedVehicle, activeTier, configOverlay, rentalConfig)

      // Check if current insurance option is valid for this vehicle + tier
      const isCurrentOptionValid = availableOptions.some(opt => opt.id === formData.insurance_option)

      // If current option is not available, reset to KASKO_BASE
      if (!isCurrentOptionValid) {
        setFormData(prev => ({ ...prev, insurance_option: 'KASKO_BASE' }))
      }
    }
  }, [formData.vehicle_id, vehicles, formData.insurance_option, customerTier])

  // Auto-set sforo (km_overage_fee) based on config overrides > vehicle type
  useEffect(() => {
    if (formData.vehicle_id && !editingId) {
      const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)
      if (!selectedVehicle) return
      if (!formData.unlimited_km) {
        // Priority: per-vehicle override da Centralina > category da Centralina
        const vehicleOverride = getVehicleSforoOverride(rentalConfig, formData.vehicle_id)
        const newSforo = vehicleOverride || getSforoForCategory(selectedVehicle, rentalConfig)
        setFormData(prev => ({ ...prev, km_overage_fee: newSforo }))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.vehicle_id, rentalConfig])

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
        .select('booking_id, signed_pdf_url')

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

      logger.log('[ReservationsTab] Car wash/mechanical bookings:', carWashAndMechanicalBookings.length)
      setCarWashBookings(carWashAndMechanicalBookings)

      // Then filter out service bookings from main bookings display
      const filteredBookings = (allBookings || []).filter(b =>
        b.status !== 'deleted' &&
        b.service_type !== 'car_wash' &&
        b.service_type !== 'mechanical_service' &&
        b.service_type !== 'mechanical'
      ).map(b => ({
        ...b,
        contracts: contractsMap.get(b.id) || null
      }))

      logger.log('[ReservationsTab] Bookings fetched (raw):', allBookings?.length)
      logger.log('[ReservationsTab] Bookings after filter:', filteredBookings.length)

      if (filteredBookings.length > 0) {
        logger.log('[ReservationsTab] First booking sample:', filteredBookings[0])
      }

      setBookings(filteredBookings)

      // Fetch customer statuses (member/elite/blacklist) for badge display
      const { data: custStatuses } = await supabase
        .from('customers_extended')
        .select('email, status_cliente')
        .in('status_cliente', ['member', 'elite', 'blacklist'])
      if (custStatuses) {
        const statusMap = new Map<string, string>()
        custStatuses.forEach(c => { if (c.email) statusMap.set(c.email.toLowerCase(), c.status_cliente) })
        setCustomerStatuses(statusMap)
      }

      // Fetch DR7 Club active subscriptions via Netlify function (bypasses RLS)
      try {
        const clubRes = await fetch('/.netlify/functions/list-club-members')
        if (clubRes.ok) {
          const clubData = await clubRes.json()
          if (clubData.members && clubData.members.length > 0) {
            const userIds = clubData.members.map((s: { user_id: string }) => s.user_id)
            setClubMembers(new Set(userIds))
            const emails = clubData.members.map((s: { email?: string }) => s.email?.toLowerCase()).filter(Boolean)
            setClubEmails(new Set(emails))
          }
        }
      } catch {
        // Club members fetch failed
      }

      // Fetch customers from bookings table (same as CustomersTab)
      const { data: bookingsForCustomers, error: bookingsCustomerError } = await supabase
        .from('bookings')
        .select('customer_name, customer_email, customer_phone, user_id, booked_at, booking_details')
        .order('booked_at', { ascending: false })

      if (bookingsCustomerError) {
        console.error('Failed to load customers from bookings:', bookingsCustomerError)
      }

      // CRITICAL FIX: Use customer ID as the canonical Map key
      // This ensures no duplicates and all customers from customers_extended are loaded
      const customerMap = new Map<string, Customer>()


      if (bookingsForCustomers) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bookingsForCustomers.forEach((booking: any) => {
          const details = booking.booking_details?.customer || {}
          const customerName = booking.customer_name || details.fullName || 'Cliente'
          const customerEmail = booking.customer_email || details.email || null
          const customerPhone = booking.customer_phone || details.phone || null

          // CRITICAL FIX: Extract customer ID from multiple sources
          // 1. booking.user_id (for website bookings)
          // 2. booking.booking_details.customer.customerId (for admin panel bookings)
          // 3. booking.booking_details.customer_id (alternative location)
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

          let customerId = booking.user_id

          // If user_id is null or invalid, check booking_details
          if (!customerId || !uuidRegex.test(customerId)) {
            customerId = details.customerId || booking.booking_details?.customer_id
          }

          // Validate the extracted customer ID
          const hasValidCustomerId = customerId && uuidRegex.test(customerId)

          if (!hasValidCustomerId) {
            // Skip customers without valid UUID - they'll come from customers_extended
            return
          }

          // ✅ FIX: Always use customer ID (UUID) as the Map key
          const existing = customerMap.get(customerId)
          if (existing) {
            // Update existing entry with additional data
            if (!existing.phone && customerPhone) existing.phone = customerPhone
            if (!existing.email && customerEmail) existing.email = customerEmail
            if (existing.full_name === 'Cliente' && customerName) existing.full_name = customerName
          } else {
            // Create new entry with customer ID as key
            customerMap.set(customerId, {
              id: customerId, // Always a valid UUID at this point
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

      logger.log('[ReservationsTab] Customers from bookings:', customerMap.size)

      // Also fetch from customers_extended via Netlify function (bypasses RLS, paginates beyond 1000 limit)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let customersExtendedData: any[] | null = null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let customersExtendedError: any = null
      try {
        const custResponse = await fetch('/.netlify/functions/list-customers')
        const custResult = await custResponse.json()
        if (custResponse.ok && custResult.customers) {
          customersExtendedData = custResult.customers
        } else {
          customersExtendedError = { message: custResult.error }
        }
      } catch (e: unknown) {
        const _errMsg = e instanceof Error ? e.message : String(e)
        customersExtendedError = { message: _errMsg }
      }

      if (customersExtendedError) {
        console.error('Failed to load customers_extended:', customersExtendedError)
      } else if (customersExtendedData) {
        logger.log('[ReservationsTab] Customers from customers_extended:', customersExtendedData.length)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            updated_at: c.updated_at || c.created_at,
            scadenza_patente: c.scadenza_patente || c.data_scadenza_patente || c.metadata?.patente?.scadenza || null,
            // Dati necessari per auto-classificare la Fascia (come PreventiviTab).
            // Senza questi, customerTier resta undefined e il prezzo km illimitati
            // cade sul default Fascia A invece della fascia reale del cliente.
            data_nascita: c.data_nascita || null,
            data_rilascio_patente: c.data_rilascio_patente || c.metadata?.patente?.rilascio || c.patente_data_rilascio || null,
          } as Customer

          // ✅ FIX: ALWAYS use customer ID as the Map key
          // This is the authoritative source - it will overwrite any booking-derived data
          customerMap.set(c.id, mappedCustomer)
        })
      }

      logger.log('[ReservationsTab] Total unique customers after customers_extended:', customerMap.size)

      // Also check legacy customers table if it exists (for backward compatibility)
      const { data: customersTableData, error: customersTableError } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })

      if (!customersTableError && customersTableData) {
        customersTableData.forEach(c => {
          // Only add if not already in map (customers_extended takes precedence)
          if (!customerMap.has(c.id)) {
            customerMap.set(c.id, c)
          }
        })
      }


      const customersArray = Array.from(customerMap.values())
      logger.log('✅ CUSTOMERS LOADED:', customersArray.length, customersArray)
      logger.log('📊 Customer sources breakdown:', {
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
      logger.log('[DEBUG] Riccardo Pilia in customers array:', riccardoPilia)

      // Debug: Show first 10 customer names
      logger.log('[DEBUG] First 10 customers:', customersArray.slice(0, 10).map(c => ({
        id: c.id,
        name: c.full_name,
        email: c.email,
        phone: c.phone
      })))

      setCustomers(customersArray)

      // Enrich bookings missing customer data from customers_extended
      setBookings(prev => prev.map(b => {
        const custId = b.user_id || b.booking_details?.customer?.customerId || b.booking_details?.customer_id
        const cust = custId ? customerMap.get(custId) : null
        const details = b.booking_details?.customer || {}
        const updates: Partial<Booking> = {}

        if (!b.customer_name || b.customer_name === 'Cliente Sconosciuto') {
          const name = cust?.full_name || details.fullName || details.name
          if (name) updates.customer_name = name
        }
        if (!b.customer_phone) {
          const phone = cust?.phone || details.phone
          if (phone) updates.customer_phone = phone
        }
        if (!b.customer_email) {
          const email = cust?.email || details.email
          if (email) updates.customer_email = email
        }

        return Object.keys(updates).length > 0 ? { ...b, ...updates } : b
      }))

      const { data: vehiclesData, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('*')
        .or('status.neq.retired,display_name.eq.Test')
        .order('display_name')

      if (vehiclesError) {
        console.error('Failed to load vehicles:', vehiclesError)
      } else {
        logger.log('[Vehicle Loading] Total vehicles loaded:', vehiclesData?.length || 0)
        logger.log('[Vehicle Loading] Vehicle details:', vehiclesData?.map(v => ({
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

        logger.log('Loaded data:', {
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



  // Validate customer data before contract generation
  // Uses save-customer Netlify function to read (bypasses RLS)
  async function validateCustomerData(booking: Booking): Promise<string[]> {
    const customerId = booking.user_id ||
      booking.booking_details?.customer?.customerId ||
      booking.booking_details?.customer?.id ||
      booking.booking_details?.customer_id

    let customer = null

    // Fetch customer via Netlify function (bypasses RLS)
    if (customerId) {
      try {
        const resp = await authFetch(`/.netlify/functions/get-customer?id=${customerId}`)
        if (resp.ok) {
          const result = await resp.json()
          if (result.customer) {
            logger.log('[validateCustomerData] ✅ Found customer by ID:', customerId)
            customer = result.customer
          }
        }
      } catch (e) {
        console.error('[validateCustomerData] get-customer fetch error:', e)
      }
    }

    // Fallback: try by email
    const resolvedEmail = booking.customer_email || booking.booking_details?.customer?.email
    const resolvedPhone = booking.customer_phone || booking.booking_details?.customer?.phone

    if (!customer && resolvedEmail) {
      try {
        const resp = await authFetch(`/.netlify/functions/get-customer?email=${encodeURIComponent(resolvedEmail)}`)
        if (resp.ok) {
          const result = await resp.json()
          if (result.customer) {
            logger.log('[validateCustomerData] ✅ Found customer by email:', resolvedEmail)
            customer = result.customer
          }
        }
      } catch (e) {
        console.error('[validateCustomerData] get-customer by email error:', e)
      }
    }

    // Fallback: try by phone
    if (!customer && resolvedPhone) {
      try {
        let normPhone = resolvedPhone.replace(/[\s\-+()]/g, '')
        if (normPhone.startsWith('00')) normPhone = normPhone.substring(2)
        if (normPhone.length === 10) normPhone = '39' + normPhone
        const resp = await authFetch(`/.netlify/functions/get-customer?phone=${encodeURIComponent(normPhone)}`)
        if (resp.ok) {
          const result = await resp.json()
          if (result.customer) {
            logger.log('[validateCustomerData] ✅ Found customer by phone:', resolvedPhone)
            customer = result.customer
          }
        }
      } catch (e) {
        console.error('[validateCustomerData] get-customer by phone error:', e)
      }
    }

    if (!customer) {
      if (resolvedEmail || resolvedPhone) {
        logger.log('[validateCustomerData] No customer record found, but booking has contact info. Backend will handle fallback.')
        return []
      }
      console.error('[validateCustomerData] ❌ No customer found by any method')
      throw new Error('Impossibile recuperare i dati del cliente dal database. Verifica che il cliente esista nella tab Clienti.')
    }

    // Validate customer data completeness
    const missing: string[] = []

    // Common fields
    if (!customer.indirizzo) missing.push('indirizzo')
    if (!customer.citta_residenza && !customer.citta) missing.push('citta_residenza')
    if (!customer.provincia_residenza) missing.push('provincia_residenza')
    if (!customer.codice_postale) missing.push('codice_postale')

    // Persona Fisica specific
    if (customer.tipo_cliente === 'persona_fisica' || !customer.tipo_cliente) {
      if (!customer.codice_fiscale) missing.push('codice_fiscale')
      if (!customer.nome) missing.push('nome')
      if (!customer.cognome) missing.push('cognome')
      if (!customer.data_nascita) missing.push('data_nascita')
      if (!customer.luogo_nascita) missing.push('luogo_nascita')
      if (!customer.sesso && !customer.metadata?.sesso) missing.push('sesso')
      if (!customer.patente && !customer.numero_patente && !customer.metadata?.patente?.numero) missing.push('numero_patente')
      if (!customer.emessa_da && !customer.metadata?.patente?.ente) missing.push('emessa_da')
      if (!customer.data_rilascio_patente && !customer.metadata?.patente?.rilascio) missing.push('data_rilascio_patente')
      if (!customer.scadenza_patente && !customer.metadata?.patente?.scadenza) missing.push('scadenza_patente')
      // Check patente scaduta (expired license)
      const scadenzaPatente = customer.scadenza_patente || customer.data_scadenza_patente || customer.metadata?.patente?.scadenza
      if (scadenzaPatente) {
        const expDate = new Date(scadenzaPatente)
        if (expDate < new Date() && !hasOverride('license_expired')) {
          requestOverride('license_expired', `Patente scaduta il ${expDate.toLocaleDateString('it-IT')}. Il cliente non può noleggiare con patente scaduta.`)
          return ['__limitation_override_requested__']
        }
      }

      // Check patente is at least 3 years old
      const patenteDate = customer.data_rilascio_patente || customer.metadata?.patente?.rilascio
      if (patenteDate) {
        const licYears = calculateLicenseYears(patenteDate)
        if (licYears < 3 && !hasOverride('license_too_recent')) {
          requestOverride('license_too_recent', 'Patente rilasciata da meno di 3 anni. Il cliente non può noleggiare.')
          return ['__limitation_override_requested__']
        }
      }

      // Tier-based validation: block no_cauzione for TIER_1
      if (customer.data_nascita && patenteDate) {
        const age = calculateAge(customer.data_nascita)
        const licYears = calculateLicenseYears(patenteDate)
        const tier = classifyDriverTier(age, licYears)
        if (tier.tier === 'BLOCKED' && !hasOverride('driver_blocked')) {
          requestOverride('driver_blocked', `Cliente non idoneo al noleggio: ${tier.reason}`)
          return ['__limitation_override_requested__']
        }
        if (tier.tier === 'TIER_1' && formData.deposit_status === 'no_cauzione' && !hasOverride('tier1_no_cauzione')) {
          requestOverride('tier1_no_cauzione', 'No Cauzione non disponibile per clienti Fascia B (età 21-25 o patente 3-4 anni).')
          return ['__limitation_override_requested__']
        }
        if (formData.deposit_status === 'no_cauzione' && formData.insurance_option === 'RCA' && !hasOverride('no_cauzione_rca_only')) {
          requestOverride('no_cauzione_rca_only', 'No Cauzione richiede una Kasko attiva. Seleziona una Kasko prima di procedere.')
          return ['__limitation_override_requested__']
        }
      }

      if (!customer.documento_numero) missing.push('documento_numero')
      if (!customer.documento_tipo) missing.push('documento_tipo')
    }

    // Azienda specific — partita_iva is enough, codice_fiscale not required
    if (customer.tipo_cliente === 'azienda') {
      if (!customer.partita_iva && !customer.codice_fiscale) missing.push('partita_iva')
    }

    return missing
  }

  async function handleResendPaymentLink(booking: Booking) {
    const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone
    const custName = booking.booking_details?.customer?.fullName || booking.customer_name || 'Cliente'
    const custEmail = booking.customer_email || booking.booking_details?.customer?.email || ''
    const bookingRef = booking.id.substring(0, 8).toUpperCase()
    const totalEur = (booking.price_total / 100).toFixed(2)

    try {
      toast.loading('Generazione nuovo link di pagamento...')

      // Always regenerate a fresh link (old one may be expired)
      const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          amount: booking.price_total / 100,
          customerEmail: custEmail,
          customerName: custName,
          description: `Prenotazione #${bookingRef} - ${booking.vehicle_name || 'Veicolo'}`,
          expirationHours: 1,
          paymentPurpose: 'booking',
        })
      })

      const linkData = await linkRes.json()
      if (!linkRes.ok || !linkData.paymentUrl) {
        toast.dismiss()
        toast.error('Errore generazione link: ' + (linkData.error || 'Riprova'))
        return
      }

      const newPaymentLink = linkData.paymentUrl

      // Update booking with new link + exact expiration timestamps
      await supabase.from('bookings').update({
        booking_details: {
          ...booking.booking_details,
          nexi_payment_link: newPaymentLink,
          nexi_order_id: linkData.orderId,
          nexi_link_id: linkData.nexiLinkId || null,
          // Exact expiration tracking (UTC)
          payment_link_sent_at: linkData.sentAt,
          payment_link_expires_at: linkData.expiresAt,
          payment_provider_expires_at: linkData.providerExpiresAt,
          nexi_link_regenerated_at: new Date().toISOString(),
        },
        payment_status: 'pending',
      }).eq('id', booking.id)

      toast.dismiss()

      if (!custPhone) {
        // Don't call navigator.clipboard.writeText here — Safari/iOS throws
        // NotAllowedError ("The request is not allowed by the user agent…")
        // when the call happens after an async gap (the preceding await
        // broke the user-gesture context). The link is already shown in
        // the toast so the admin can select-copy it manually.
        toast.success(`Link generato: ${newPaymentLink}`, { duration: 10000 })
        return
      }

      // Send via WhatsApp
      await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customPhone: custPhone,
          templateKey: 'payment_link_customer',
          templateVars: { '{customer_name}': custName, '{booking_id}': bookingRef, '{total}': totalEur, '{payment_link}': newPaymentLink, '{expiry}': '1 ora' }
        })
      })
      toast.success('Nuovo link di pagamento generato e inviato via WhatsApp!')

      // Refresh bookings list
      await loadData()
    } catch (err: unknown) {
      toast.dismiss()
      const _errMsg = err instanceof Error ? err.message : String(err)
      console.error('Error regenerating payment link:', err)
      toast.error('Errore: ' + _errMsg)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleGenerateContract(booking: Booking, _silent?: boolean) {
    logger.log('[ReservationsTab] 🖱️ Generating contract for booking:', booking.id)
    if (!booking.id) {
      console.error('[ReservationsTab] ❌ No booking ID found')
      return
    }

    // Skip contract for non-rental bookings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svcType = booking.service_type || (booking as any).booking_details?.service_type || ''
    if (svcType === 'car_wash' || svcType === 'mechanical_service' || svcType === 'mechanical') {
      logger.log(`[handleGenerateContract] Skipping — service_type=${svcType} is not a rental`)
      return
    }

    // 1. Validate Data
    let missing: string[]
    try {
      missing = await validateCustomerData(booking)
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('[handleGenerateContract] Validation error:', error)
      alert(_errMsg)
      return
    }

    if (missing.includes('__limitation_override_requested__')) return

    if (missing.length > 0) {
      logger.warn('⚠️ Missing fields for contract:', missing)
      // Don't block — generate-contract backend has extensive fallbacks
      // Just log it, contract will be generated with available data
      logger.log('[handleGenerateContract] Proceeding despite missing fields — backend handles fallbacks')
    }

    setGeneratingContract(true)
    try {
      // Use the new generic contract generation function
      const response = await authFetch('/.netlify/functions/generate-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate contract')
      }

      // Open PDF in new tab
      if (data.url) {
        window.open(data.url, '_blank')
      }

      logAdminAction('generate_contract', 'booking', booking.id, buildBookingContext(booking))

      // Reload data to show the contract link in the UI
      await loadData()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error generating contract:', error)
      alert('Errore nella generazione del contratto: ' + _errMsg + '\n\nAssicurati di aver caricato "master_contract.pdf" in Supabase Storage > contracts > templates.')
    } finally {
      setGeneratingContract(false)
    }
  }

  async function handleResendContract(booking: Booking) {
    if (!booking.id) return
    try {
      toast.loading('Rinvio contratto...', { id: 'resend-contract' })

      // signature-init can resolve the contract itself by booking_id using
      // service-role — bypasses any frontend RLS read issues. Just call it.
      // If no contract exists yet, it'll return 404 and we'll generate first.
      const sigRes = await fetch('/.netlify/functions/signature-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id })
      })
      const sigData = await sigRes.json().catch(() => ({} as any))

      if (sigRes.ok) {
        toast.dismiss('resend-contract')
        toast.success('Link firma contratto inviato via WhatsApp!')
        logAdminAction('resend_contract', 'booking', booking.id, buildBookingContext(booking))
        return
      }

      // 404 means no contract exists yet — try to generate it and retry once.
      if (sigRes.status === 404 || /non trovato/i.test(sigData?.error || '')) {
        toast.loading('Contratto non trovato — lo genero ora...', { id: 'resend-contract' })
        const genRes = await authFetch('/.netlify/functions/generate-contract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.id })
        })
        const genData = await genRes.json().catch(() => ({} as any))
        if (!genRes.ok) {
          toast.dismiss('resend-contract')
          toast.error('Contratto non generato: ' + (genData?.error || `HTTP ${genRes.status}`), { duration: 12000 })
          return
        }

        // Retry signature-init
        const retryRes = await fetch('/.netlify/functions/signature-init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.id })
        })
        const retryData = await retryRes.json().catch(() => ({} as any))
        toast.dismiss('resend-contract')
        if (retryRes.ok) {
          toast.success('Link firma contratto inviato via WhatsApp!')
          logAdminAction('resend_contract', 'booking', booking.id, buildBookingContext(booking))
          return
        }

        // FINAL FALLBACK: signature-init still broken — send the raw PDF URL
        // via the SAME signature_request_link template the primary path
        // uses. Body lives in Messaggi di Sistema Pro (pro_richiesta_firma);
        // never hardcode the message here so admin edits to the template
        // always take effect.
        console.warn('[handleResendContract] signature-init retry failed, attempting direct WhatsApp fallback', retryData)
        toast.loading('Invio diretto PDF via WhatsApp...', { id: 'resend-contract' })

        const fallbackGenRes = await authFetch('/.netlify/functions/generate-contract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.id })
        })
        const fallbackGenData = await fallbackGenRes.json().catch(() => ({} as any))

        if (!fallbackGenRes.ok || !fallbackGenData?.url) {
          toast.dismiss('resend-contract')
          toast.error(
            'Impossibile inviare il contratto: ' +
              (fallbackGenData?.error || retryData?.error || `HTTP ${retryRes.status}`),
            { duration: 12000 }
          )
          return
        }

        const pdfUrl: string = fallbackGenData.url

        const waRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: booking.customer_phone,
            templateKey: 'signature_request_link',
            templateVars: {
              signerName: booking.customer_name || 'Cliente',
              contractNumber: fallbackGenData.contract_number || '',
              signingUrl: pdfUrl,
            },
          })
        })

        toast.dismiss('resend-contract')
        if (waRes.ok) {
          toast.success('Contratto inviato direttamente via WhatsApp (senza signature-init)', { duration: 8000 })
          logAdminAction('resend_contract_fallback', 'booking', booking.id, buildBookingContext(booking))
        } else {
          const waData = await waRes.json().catch(() => ({} as any))
          toast.error(
            'WhatsApp fallback fallito: ' + (waData?.error || `HTTP ${waRes.status}`) +
            `\nURL contratto: ${pdfUrl}`,
            { duration: 15000 }
          )
        }
        return
      }

      toast.dismiss('resend-contract')
      toast.error('Errore invio: ' + (sigData?.error || `HTTP ${sigRes.status}`), { duration: 10000 })
    } catch (err: any) {
      toast.dismiss('resend-contract')
      toast.error('Errore: ' + err.message)
    }
  }

  async function handleGenerateInvoice(booking: Booking) {
    if (!booking.id) return

    // 1. Validate Data for Invoice
    let missing: string[]
    try {
      missing = await validateCustomerData(booking)
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('[handleGenerateInvoice] Validation error:', error)
      alert(_errMsg)
      return
    }

    if (missing.includes('__limitation_override_requested__')) return

    if (missing.length > 0) {
      logger.warn('⚠️ Missing fields for invoice:', missing)

      const customerId = booking.user_id || booking.booking_details?.customer?.id || booking.booking_details?.customer_id
      let customerData = {}

      if (customerId) {
        try {
          const resp = await authFetch(`/.netlify/functions/get-customer?id=${customerId}`)
          if (resp.ok) {
            const result = await resp.json()
            customerData = result.customer || { id: customerId }
          } else {
            customerData = { id: customerId }
          }
        } catch (e) {
          console.error('[handleGenerateInvoice] get-customer error:', e)
          customerData = { id: customerId }
        }
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
      const response = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, includeIVA })
      })

      const data = await response.json()
      if (!response.ok) {
        if (data.invoiceNumber) {
          // Invoice already exists — backend auto-sends to SDI
          return
        } else {
          // Show detailed error from backend
          const errorMsg = data.message || data.error || 'Impossibile generare la fattura'
          const errorDetails = data.details ? `\n\nDettagli: ${data.details}` : ''
          const errorHint = data.hint ? `\n\nSuggerimento: ${data.hint}` : ''
          throw new Error(errorMsg + errorDetails + errorHint)
        }
      }

      // Success - Invoice Created via Booking
      const invoice = data.invoice

      // Open PDF first as courtesy (non-blocking)
      try {
        const invoiceId = invoice.id
        const pdfResponse = await authFetch('/.netlify/functions/generate-invoice-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId })
        })
        if (pdfResponse.ok) {
          const html = await pdfResponse.text()
          const blob = new Blob([html], { type: 'text/html' })
          const url = URL.createObjectURL(blob)
          window.open(url, '_blank')
        }
      } catch (err) {
        logger.warn('PDF auto-open failed, continuing flow:', err)
      }

      logAdminAction('generate_fattura', 'booking', booking.id, buildBookingContext(booking))

      // SDI send is now handled automatically by the backend
      loadData()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error generating invoice:', error)
      const errorMessage = _errMsg || ''

      // Check for validation errors (missing address/tax code)
      if (errorMessage.includes('obbligatorio') || errorMessage.includes('incomplete') || errorMessage.includes('required') || errorMessage.includes('missing')) {
        // Show full error with debug info so we can diagnose
        alert('Dati cliente incompleti per la fattura:\n\n' + errorMessage)
        if (booking.user_id) {
          openEditCustomer(booking.user_id)
          return
        }
        return
      }

      alert('Errore nella generazione della fattura:\n\n' + errorMessage)
    } finally {
      setGeneratingInvoice(false)
    }
  }

  // Pre-auth function removed — Nexi Pay by Link doesn't support capture via API

  async function handleDeleteBooking(bookingId: string, bookingType: 'booking' | 'reservation') {
    try {
      // Get booking details before deleting
      let customerName = ''
      let vehicleName = ''

      if (bookingType === 'booking') {
        const booking = bookings.find(b => b.id === bookingId)
        customerName = booking?.customer_name || ''
        vehicleName = booking?.vehicle_name || ''

        // SOFT DELETE via Netlify function (uses service role key to bypass RLS)
        const deleteRes = await authFetch('/.netlify/functions/delete-booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId })
        })

        if (!deleteRes.ok) {
          const errData = await deleteRes.json().catch(() => ({}))
          throw new Error(errData.error || 'Errore durante l\'eliminazione')
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
        logger.log('✅ Calendar event deleted successfully')
      } catch (calendarError) {
        console.error('⚠️ Failed to delete calendar event:', calendarError)
        // Don't fail the whole deletion if calendar delete fails
      }

      {
        const bookingForLog = bookingType === 'booking' ? bookings.find(b => b.id === bookingId) : null
        logAdminAction('delete_booking', 'booking', bookingId, {
          ...buildBookingContext(bookingForLog),
          customer: bookingForLog?.customer_name || customerName,
          vehicle: bookingForLog?.vehicle_name || vehicleName,
        })
      }
      toast.success('Prenotazione eliminata')
      loadData()
    } catch (error) {
      console.error('Failed to delete booking:', error)
      toast.error('Errore durante l\'eliminazione: ' + (error as Error).message)
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
    let customerId = booking.user_id ||
      booking.booking_details?.customer?.id ||
      booking.booking_details?.customer?.customerId ||
      booking.booking_details?.customer_id ||
      ''

    // Get customer name from booking for fallback matching
    const customerName = booking.customer_name ||
      booking.booking_details?.customer?.fullName ||
      booking.booking_details?.customer?.name ||
      ''
    const customerEmail = booking.customer_email ||
      booking.booking_details?.customer?.email ||
      ''

    logger.log('[handleEditBooking] 👤 CUSTOMER DATA:', {
      extractedId: customerId,
      customerName,
      customerEmail,
      booking_user_id: booking.user_id,
      booking_details_customer: booking.booking_details?.customer
    })

    // Check if customer exists in our customers array
    let matchedCustomer = customers.find(c => c.id === customerId)

    if (!matchedCustomer && customerName) {
      // Try to find by name if ID doesn't match
      matchedCustomer = customers.find(c =>
        c.full_name?.toLowerCase() === customerName.toLowerCase()
      )
      if (matchedCustomer) {
        logger.log('[handleEditBooking] ✅ Found customer by name match:', matchedCustomer.full_name)
        customerId = matchedCustomer.id
      }
    }

    if (!matchedCustomer && customerEmail) {
      // Try to find by email if name doesn't match
      matchedCustomer = customers.find(c =>
        c.email?.toLowerCase() === customerEmail.toLowerCase()
      )
      if (matchedCustomer) {
        logger.log('[handleEditBooking] ✅ Found customer by email match:', matchedCustomer.full_name)
        customerId = matchedCustomer.id
      }
    }

    if (!matchedCustomer) {
      logger.warn('[handleEditBooking] ⚠️ Customer NOT found in customers array!', {
        searchedId: customerId,
        searchedName: customerName,
        searchedEmail: customerEmail,
        totalCustomers: customers.length
      })
    } else {
      logger.log('[handleEditBooking] ✅ Customer found:', matchedCustomer.full_name, matchedCustomer.id)
    }

    // Populate rental data
    const pickupDate = booking.pickup_date ? new Date(typeof booking.pickup_date === 'number' ? booking.pickup_date * 1000 : booking.pickup_date) : null
    const dropoffDate = booking.dropoff_date ? new Date(typeof booking.dropoff_date === 'number' ? booking.dropoff_date * 1000 : booking.dropoff_date) : null

    // COMPREHENSIVE VEHICLE MATCHING LOGIC
    logger.log('[handleEditBooking] 🔍 VEHICLE SEARCH INITIATED')
    logger.log('[handleEditBooking] Booking data:', {
      id: booking.id,
      vehicle_id: booking.vehicle_id,
      vehicle_plate: booking.vehicle_plate,
      vehicle_name: booking.vehicle_name,
      booking_details_vehicle_id: booking.booking_details?.vehicle_id,
      booking_details_vehicle_name: booking.booking_details?.vehicle_name,
      booking_details_vehicle_plate: booking.booking_details?.vehicle_plate
    })
    logger.log('[handleEditBooking] Available vehicles:', vehicles.length)
    logger.log('[handleEditBooking] Vehicles list:', vehicles.map(v => ({
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
        logger.log('[handleEditBooking] ✅ Found by vehicle_id:', vehicle.display_name)
      }
    }

    // Method 2: Match by booking_details.vehicle_id
    if (!vehicle && booking.booking_details?.vehicle_id) {
      vehicle = vehicles.find(v => v.id === (booking.booking_details?.vehicle_id || ''))
      if (vehicle) {
        matchMethod = 'booking_details.vehicle_id'
        logger.log('[handleEditBooking] ✅ Found by booking_details.vehicle_id:', vehicle.display_name)
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
        logger.log('[handleEditBooking] ✅ Found by plate:', vehicle.display_name)
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
        logger.log('[handleEditBooking] ✅ Found by booking_details.vehicle_plate:', vehicle.display_name)
      }
    }

    // NOTE: Name-based matching (Methods 5-8) intentionally removed.
    // Matching by vehicle name is dangerous when multiple vehicles share the same model name
    // (e.g. "Renault Clio Orange" and "Renault Clio Blue"). Always match by plate or vehicle_id.

    // FINAL RESULT
    if (!vehicle) {
      console.error('[handleEditBooking] ❌ WARNING: VEHICLE NOT FOUND AFTER ALL METHODS!')
      console.error('[handleEditBooking] Booking will open with vehicle_id preserved, but vehicle may not be in dropdown.')
      logger.warn('[handleEditBooking] Vehicle data from booking:', {
        vehicle_id: booking.vehicle_id,
        vehicle_plate: booking.vehicle_plate,
        vehicle_name: booking.vehicle_name,
        booking_details_vehicle_id: booking.booking_details?.vehicle_id
      })

      // Show warning but allow editing
      alert(
        'ATTENZIONE\n\n' +
        'Il veicolo associato a questa prenotazione non è stato trovato nella lista veicoli corrente.\n\n' +
        'Possibili cause:\n' +
        '- Il veicolo è stato ritirato o rimosso\n' +
        '- Problema di sincronizzazione dati\n\n' +
        'Dati veicolo nella prenotazione:\n' +
        `- ID: ${booking.vehicle_id || 'N/A'}\n` +
        `- Targa: ${booking.vehicle_plate || 'N/A'}\n` +
        `- Nome: ${booking.vehicle_name || 'N/A'}\n\n` +
        'Puoi comunque modificare la prenotazione selezionando un nuovo veicolo.'
      )
    } else {
      logger.log(`[handleEditBooking] ✅ VEHICLE MATCHED: ${vehicle.display_name} (via ${matchMethod})`)
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
      // CRITICAL: Convert UTC times from database to Rome local time for display
      // Use toLocaleString with Europe/Rome timezone to handle DST automatically
      pickup_date: pickupDate ? (() => {
        // Extract date parts using Rome timezone
        const year = pickupDate.toLocaleString('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' });
        const month = pickupDate.toLocaleString('en-CA', { timeZone: 'Europe/Rome', month: '2-digit' });
        const day = pickupDate.toLocaleString('en-CA', { timeZone: 'Europe/Rome', day: '2-digit' });
        return `${year}-${month}-${day}`;
      })() : '',
      pickup_time: pickupDate ? (() => {
        return pickupDate.toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false });
      })() : '',
      return_date: dropoffDate ? (() => {
        const year = dropoffDate.toLocaleString('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' });
        const month = dropoffDate.toLocaleString('en-CA', { timeZone: 'Europe/Rome', month: '2-digit' });
        const day = dropoffDate.toLocaleString('en-CA', { timeZone: 'Europe/Rome', day: '2-digit' });
        return `${year}-${month}-${day}`;
      })() : '',
      return_time: dropoffDate ? (() => {
        return dropoffDate.toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false });
      })() : '',
      pickup_location: pickupLoc,
      dropoff_location: dropoffLoc,
      status: booking.status,
      payment_status: booking.payment_status || 'paid',
      payment_method: booking.payment_method || 'Contanti',
      amount_paid: booking.booking_details?.amountPaid ? centsToEurStr(Math.round(booking.booking_details.amountPaid)) : '0',
      // Subtract delivery/pickup fees to get BASE rental amount only
      // (fees are re-added on save at price_total calculation)
      // Only subtract if the corresponding flag is enabled to avoid drift when toggling off
      total_amount: centsToEurStr(Math.round(booking.price_total
        - ((booking.delivery_enabled || booking.booking_details?.delivery_enabled) ? (booking.delivery_fee || 0) : 0)
        - ((booking.pickup_enabled || booking.booking_details?.pickup_enabled) ? (booking.pickup_fee || 0) : 0)
      )),
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
      // Cauzione amount + status — read in TWO shapes:
      //  • admin-shape (created via this form): booking_details.deposit + booking_details.deposit_status
      //  • website-shape (CarBookingWizard): top-level booking.deposit_amount
      //    + booking_details.depositOption ('no_deposit' / 'vehicle_deposit' / 'card_deposit_*')
      // Without the second branch, every website booking opened in admin showed
      // deposit=0 and status='da_incassare' regardless of what the customer chose.
      deposit: (() => {
        const adminShape = booking.booking_details?.deposit
        if (adminShape != null && String(adminShape) !== '') return String(adminShape)
        const topLevel = (booking as { deposit_amount?: number | null }).deposit_amount
        if (topLevel != null && Number(topLevel) > 0) return String(topLevel)
        return '0'
      })(),
      deposit_status: (() => {
        const explicit = booking.booking_details?.deposit_status
        if (explicit) return explicit as 'da_incassare' | 'incassata' | 'no_cauzione'
        // Website bookings: depositOption='no_deposit' → no_cauzione status.
        const opt = booking.booking_details?.depositOption
        if (opt === 'no_deposit') return 'no_cauzione' as const
        return 'da_incassare' as const
      })(),
      // Carry the website's option id so the admin form's deposit_option_id
      // dropdown can preselect it. Otherwise the operator has to pick again.
      deposit_option_id: booking.booking_details?.depositOption || booking.booking_details?.deposit_option_id || '',
      // Cauzione Auto
      cauzione_auto: !!booking.booking_details?.cauzione_auto,
      cauzione_targa: booking.booking_details?.cauzione_targa || '',
      cauzione_targa_year: booking.booking_details?.cauzione_veicolo?.year || '',
      cauzione_targa_brand: booking.booking_details?.cauzione_veicolo?.brand || '',
      cauzione_targa_model: booking.booking_details?.cauzione_veicolo?.model || '',
      cauzione_proprietario_tipo: booking.booking_details?.garante_veicolo?.tipo || 'guidatore',
      garante_customer_id: booking.booking_details?.garante_veicolo?.customer_id || '',
      garante_nome: booking.booking_details?.garante_veicolo?.nome || '',
      garante_cognome: booking.booking_details?.garante_veicolo?.cognome || '',
      garante_codice_fiscale: booking.booking_details?.garante_veicolo?.codice_fiscale || '',
      garante_sesso: booking.booking_details?.garante_veicolo?.sesso || '',
      garante_indirizzo: booking.booking_details?.garante_veicolo?.indirizzo || '',
      garante_cap: booking.booking_details?.garante_veicolo?.cap || '',
      garante_citta: booking.booking_details?.garante_veicolo?.citta || '',
      garante_provincia: booking.booking_details?.garante_veicolo?.provincia || '',
      garante_birth_date: booking.booking_details?.garante_veicolo?.birth_date || '',
      garante_birth_place: booking.booking_details?.garante_veicolo?.birth_place || '',
      garante_birth_provincia: booking.booking_details?.garante_veicolo?.birth_provincia || '',
      garante_phone: booking.booking_details?.garante_veicolo?.phone || '',
      garante_email: booking.booking_details?.garante_veicolo?.email || '',
      km_overage_fee: booking.km_overage_fee ? (booking.km_overage_fee).toFixed(2) : '',
      unlimited_km: booking.booking_details?.unlimited_km === true
        || booking.booking_details?.km_limit === 'Illimitati'
        // Website-created bookings store unlimited in kmPackage.type / includedKm.
        || booking.booking_details?.kmPackage?.type === 'unlimited'
        || Number(booking.booking_details?.kmPackage?.includedKm) >= 9999
        || false,
      km_limit: (booking.booking_details?.unlimited_km === true
        || booking.booking_details?.km_limit === 'Illimitati'
        || booking.booking_details?.kmPackage?.type === 'unlimited'
        || Number(booking.booking_details?.kmPackage?.includedKm) >= 9999)
        ? '0'
        : (booking.booking_details?.km_limit
            || (typeof booking.booking_details?.kmPackage?.includedKm === 'number' ? String(booking.booking_details.kmPackage.includedKm) : null)
            || DEFAULT_KM_LIMIT),
      // Home Delivery & Pickup
      delivery_enabled: booking.delivery_enabled || booking.booking_details?.delivery_enabled || false,
      delivery_street: booking.delivery_address?.street || booking.booking_details?.delivery_address?.street || '',
      delivery_city: booking.delivery_address?.city || booking.booking_details?.delivery_address?.city || '',
      delivery_zip: booking.delivery_address?.zip || booking.booking_details?.delivery_address?.zip || '',
      delivery_province: booking.delivery_address?.province || booking.booking_details?.delivery_address?.province || '',
      delivery_notes: booking.delivery_address?.notes || booking.booking_details?.delivery_address?.notes || '',
      delivery_fee: booking.delivery_fee != null ? centsToEurStr(Math.round(booking.delivery_fee)) : (booking.booking_details?.delivery_fee || '0'),
      pickup_enabled: booking.pickup_enabled || booking.booking_details?.pickup_enabled || false,
      pickup_street: booking.pickup_address?.street || booking.booking_details?.pickup_address?.street || '',
      pickup_city: booking.pickup_address?.city || booking.booking_details?.pickup_address?.city || '',
      pickup_zip: booking.pickup_address?.zip || booking.booking_details?.pickup_address?.zip || '',
      pickup_province: booking.pickup_address?.province || booking.booking_details?.pickup_address?.province || '',
      pickup_notes: booking.pickup_address?.notes || booking.booking_details?.pickup_address?.notes || '',
      pickup_fee: booking.pickup_fee != null ? centsToEurStr(Math.round(booking.pickup_fee)) : (booking.booking_details?.pickup_fee || '0'),
      notes: booking.booking_details?.notes || booking.notes || '',
      // Experience Services & DR7 Flex
      experience_services: booking.booking_details?.experience_services || {},
      dr7_flex: booking.booking_details?.dr7_flex || false,
    })

    // Restore tier from booking_details or re-compute from customer
    if (booking.booking_details?.driver_tier && booking.booking_details?.driver_age != null && booking.booking_details?.driver_license_years != null) {
      setCustomerTier({
        tier: booking.booking_details.driver_tier as DriverTier,
        driverAge: booking.booking_details.driver_age,
        licenseYears: booking.booking_details.driver_license_years,
        reason: booking.booking_details.driver_tier === 'TIER_2' ? 'Fascia A — Conducente esperto' : 'Fascia B — Conducente giovane o patente recente',
      })
    } else if (customerId) {
      // Re-compute tier from customer data
      fetch(`/.netlify/functions/get-customer?id=${customerId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data?.customer) return
          const cust = data.customer
          const birthDate = cust.data_nascita
          const patenteDate = cust.data_rilascio_patente || cust.metadata?.patente?.rilascio
          if (birthDate && patenteDate) {
            setCustomerTier(classifyDriverTier(calculateAge(birthDate), calculateLicenseYears(patenteDate)))
          }
        })
        .catch(() => {})
    }

    setEditingId(booking.id)
    newSession('booking_edit')
    setEditingOriginalPaymentStatus(booking.payment_status || 'pending')
    setConfirmBooking(booking.booking_details?.manually_confirmed === true)
    setShowForm(true)
  }

  // ===== SIMPLE EXTEND BOOKING FUNCTION =====
  function handleExtendBooking(booking: Booking) {
    logger.log('[handleExtendBooking] Opening extend modal for booking:', booking.id)

    // Pre-populate with current return date in Rome timezone
    const currentReturnDate = new Date(booking.dropoff_date)
    const romeDateStr = currentReturnDate.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) // YYYY-MM-DD
    const romeTimeStr = currentReturnDate.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false })

    setExtendingBooking(booking)
    const currentUnlimitedKm = booking.booking_details?.unlimited_km || booking.booking_details?.km_limit === 'Illimitati'
    setExtendData({
      new_return_date: romeDateStr,
      new_return_time: romeTimeStr,
      additional_amount: '0',
      extension_payment_status: 'pending',
      extension_payment_method: '',
      link_expiration_hours: '1',
      notes: '',
      change_vehicle: false,
      new_vehicle_id: '',
      show_all_vehicles: false,
      extension_km_added: '',
      extension_unlimited_km: currentUnlimitedKm || false
    })
    setShowExtendModal(true)
  }

  async function handleConfirmExtend() {
    if (!extendingBooking) return

    setIsExtending(true)

    try {
      // Build new dropoff datetime with explicit Rome timezone offset
      function getRomeOffsetForDate(dateString: string): string {
        // Calculate actual UTC offset for Europe/Rome on the given date
        const date = new Date(`${dateString}T12:00:00Z`)
        const romeStr = date.toLocaleString('en-US', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false })
        const romeHour = parseInt(romeStr.split(',').pop()?.trim() || '12')
        const utcHour = date.getUTCHours()
        const diff = romeHour - utcHour
        return diff === 2 ? '+02:00' : '+01:00'
      }
      const dropoffOffset = getRomeOffsetForDate(extendData.new_return_date)
      const newDropoffDateTime = new Date(`${extendData.new_return_date}T${extendData.new_return_time}:00${dropoffOffset}`)

      // Calculate new total — use eurToCents (string-based) to avoid float drift
      const additionalAmountCents = eurToCents(extendData.additional_amount || '0')
      const additionalAmount = additionalAmountCents / 100
      const newTotal = Math.round(extendingBooking.price_total + additionalAmountCents)

      // Resolve new vehicle if car change requested
      let newVehicle: Vehicle | null = null
      if (extendData.change_vehicle && extendData.new_vehicle_id) {
        newVehicle = vehicles.find(v => v.id === extendData.new_vehicle_id) || null
      }

      // Calculate KM limit update
      const extensionKmAdded = parseInt(extendData.extension_km_added) || 0
      const previousKmLimit = extendingBooking.booking_details?.km_limit
      let newKmLimit = previousKmLimit

      if (extendData.extension_unlimited_km) {
        newKmLimit = 'Illimitati'
      } else if (extensionKmAdded > 0 && previousKmLimit && previousKmLimit !== 'Illimitati') {
        newKmLimit = String(parseInt(String(previousKmLimit)) + extensionKmAdded)
      }

      // Update booking_details with extension info
      // Reset deposit_reminder_sent so IBAN message re-sends 60 min after the NEW dropoff
      const updatedBookingDetails = {
        ...extendingBooking.booking_details,
        deposit_reminder_sent: false,
        deposit_reminder_sent_at: null,
        iban_request_sent: false,
        day_before_reminder_sent: false,
        day_before_reminder_sent_at: null,
        km_limit: newKmLimit,
        unlimited_km: extendData.extension_unlimited_km,
        // Update vehicle info in booking_details if car changed
        ...(newVehicle ? {
          vehicle: {
            ...extendingBooking.booking_details?.vehicle,
            id: newVehicle.id,
            name: newVehicle.display_name,
            plate: newVehicle.plate || newVehicle.targa || '',
          },
          vehicle_id: newVehicle.id,
        } : {}),
        extension_history: [
          ...(extendingBooking.booking_details?.extension_history || []),
          {
            extended_at: new Date().toISOString(),
            previous_dropoff: extendingBooking.dropoff_date,
            new_dropoff: newDropoffDateTime.toISOString(),
            additional_amount: additionalAmount,
            payment_status: extendData.extension_payment_status, // 'paid' or 'pending'
            notes: extendData.notes,
            km_added: extensionKmAdded > 0 ? extensionKmAdded : undefined,
            unlimited_km: extendData.extension_unlimited_km || undefined,
            ...(newVehicle ? {
              previous_vehicle_id: extendingBooking.vehicle_id,
              previous_vehicle_name: extendingBooking.vehicle_name,
              new_vehicle_id: newVehicle.id,
              new_vehicle_name: newVehicle.display_name,
            } : {})
          }
        ]
      }

      // Build update payload
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookingUpdate: Record<string, any> = {
        dropoff_date: newDropoffDateTime.toISOString(),
        price_total: newTotal,
        booking_details: updatedBookingDetails,
        updated_at: new Date().toISOString()
      }

      // If car changed, update vehicle fields on the booking
      if (newVehicle) {
        bookingUpdate.vehicle_id = newVehicle.id
        bookingUpdate.vehicle_name = newVehicle.display_name
        bookingUpdate.vehicle_plate = newVehicle.plate || newVehicle.targa || ''
      }

      // Update the booking directly - NO validation checks
      const { error: updateError } = await supabase
        .from('bookings')
        .update(bookingUpdate)
        .eq('id', extendingBooking.id)

      if (updateError) {
        console.error('[handleConfirmExtend] Update error:', updateError)
        alert('Errore durante l\'estensione: ' + updateError.message)
        return
      }

      logger.log('[handleConfirmExtend] ✅ Booking extended successfully')
      logAdminAction('extend_booking', 'booking', extendingBooking.id, {
        ...buildBookingContext(extendingBooking),
        old_dropoff: extendingBooking.dropoff_date,
        new_dropoff: newDropoffDateTime.toISOString(),
      })

      // Send WhatsApp notification for extension
      try {
        const prevDropoff = new Date(extendingBooking.dropoff_date)
        const prevDropoffStr = prevDropoff.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
        const prevTimeStr = prevDropoff.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
        const newDropoffStr = newDropoffDateTime.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
        const newTimeStr = newDropoffDateTime.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
        const bookingIdShort = extendingBooking.id.substring(0, 8).toUpperCase()

        const adminExtPayLabel = extendData.extension_payment_status === 'paid'
          ? `Pagato${extendData.extension_payment_method ? ` (${extendData.extension_payment_method})` : ''}`
          : extendData.extension_payment_status === 'nexi_pay_by_link'
          ? 'Nexi Pay by Link'
          : 'Da saldare'

        let extensionMsg = `*ESTENSIONE PRENOTAZIONE NOLEGGIO*\n\n`
        extensionMsg += `*ID:* DR7-${bookingIdShort}\n`
        extensionMsg += `*Cliente:* ${extendingBooking.customer_name || extendingBooking.booking_details?.customer?.fullName || 'N/A'}\n`
        if (newVehicle) {
          extensionMsg += `*Veicolo precedente:* ${extendingBooking.vehicle_name || 'N/A'}\n`
          extensionMsg += `*Nuovo veicolo:* ${newVehicle.display_name} (${newVehicle.plate || newVehicle.targa || ''})\n`
        } else {
          extensionMsg += `*Veicolo:* ${extendingBooking.vehicle_name || 'N/A'}\n`
        }
        extensionMsg += `*Riconsegna precedente:* ${prevDropoffStr} alle ${prevTimeStr}\n`
        extensionMsg += `*Nuova riconsegna:* ${newDropoffStr} alle ${newTimeStr}\n`
        extensionMsg += `*Importo aggiuntivo:* €${additionalAmount.toFixed(2)}\n`
        extensionMsg += `*Nuovo totale:* €${(newTotal / 100).toFixed(2)}\n`
        extensionMsg += `*Km:* ${extendData.extension_unlimited_km ? 'Illimitati' : (extensionKmAdded > 0 ? `+${extensionKmAdded} km (totale: ${newKmLimit} Km)` : `${newKmLimit} Km (invariato)`)}\n`
        extensionMsg += `*Pagamento estensione:* ${adminExtPayLabel}`

        // Send to admin notification phone
        await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customMessage: extensionMsg })
        })
        logger.log('[handleConfirmExtend] ✅ WhatsApp admin notification sent')

        // Send to customer phone — resolve from multiple sources
        let customerPhone = extendingBooking.customer_phone || extendingBooking.booking_details?.customer?.phone

        // Fallback: look up phone from customers_extended if not on the booking
        if (!customerPhone) {
          const custEmail = extendingBooking.customer_email || extendingBooking.booking_details?.customer?.email
          const custId = extendingBooking.booking_details?.customer?.customerId || extendingBooking.booking_details?.customer_id
          if (custId) {
            const { data: cust } = await supabase.from('customers_extended').select('telefono').eq('id', custId).maybeSingle()
            if (cust?.telefono) customerPhone = cust.telefono
          }
          if (!customerPhone && custEmail) {
            const { data: cust } = await supabase.from('customers_extended').select('telefono').eq('email', custEmail).maybeSingle()
            if (cust?.telefono) customerPhone = cust.telefono
          }
        }

        if (customerPhone) {
          const customerFirstName = extendingBooking.booking_details?.customer?.firstName
            || extendingBooking.customer_name?.split(' ')[0]
            || 'Cliente'

          const extraDaysCount = Math.max(
            1,
            Math.ceil((newDropoffDateTime.getTime() - prevDropoff.getTime()) / (1000 * 60 * 60 * 24))
          )
          const vehicleNameForMsg = newVehicle
            ? newVehicle.display_name
            : (extendingBooking.vehicle_name || 'N/A')

          const waResp = await fetch('/.netlify/functions/send-whatsapp-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customPhone: customerPhone,
              templateKey: 'pro_estensione_noleggio',
              templateVars: {
                customer_name: customerFirstName,
                vehicle_name: vehicleNameForMsg,
                new_dropoff_date: newDropoffStr,
                new_dropoff_time: newTimeStr,
                extra_days: String(extraDaysCount),
                extra_cost: additionalAmount.toFixed(2),
              },
              skipHeader: true,
            })
          })
          const waResult = await waResp.json().catch(() => ({}))
          if (!waResp.ok || waResult?.skipped) {
            toast.error('Template mancante in Messaggi di Sistema Pro: pro_estensione_noleggio')
          } else {
            logger.log('[handleConfirmExtend] ✅ WhatsApp customer notification sent to', customerPhone)
          }
        } else {
          logger.warn('[handleConfirmExtend] ⚠️ No customer phone — skipped customer notification')
        }
      } catch (whatsappError) {
        console.error('[handleConfirmExtend] ⚠️ WhatsApp notification failed:', whatsappError)
      }

      // Sync cauzione with new return date
      try {
        const depositAmount = parseFloat(extendingBooking.booking_details?.deposit) || extendingBooking.deposit_amount || 0
        await fetch('/.netlify/functions/sync-booking-cauzione', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: extendingBooking.id,
            customerId: extendingBooking.user_id,
            vehicleId: newVehicle ? newVehicle.id : extendingBooking.vehicle_id,
            returnDate: newDropoffDateTime.toISOString(),
            depositAmount: depositAmount,
            paymentMethod: extendingBooking.payment_method || 'carta',
            depositPaid: extendingBooking.booking_details?.deposit_status === 'incassata',
            depositStatus: extendingBooking.booking_details?.deposit_status || 'da_incassare'
          })
        })
        logger.log('[handleConfirmExtend] ✅ Cauzione synced with new return date')
      } catch (cauzioneError) {
        console.error('[handleConfirmExtend] ⚠️ Cauzione sync failed:', cauzioneError)
      }

      // Auto-generate fattura for extension when paid
      if (extendData.extension_payment_status === 'paid' && additionalAmount > 0) {
        try {
          logger.log('[handleConfirmExtend] Generating extension fattura for €' + additionalAmount.toFixed(2))
          const invoiceRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: extendingBooking.id, includeIVA: true, extensionAmount: additionalAmount })
          })
          if (invoiceRes.ok) {
            logger.log('[handleConfirmExtend] ✅ Extension fattura generated and sent to SDI')
          } else {
            const errData = await invoiceRes.json()
            const errMsg = errData.message || errData.error || 'Errore sconosciuto'
            logger.warn('[handleConfirmExtend] ⚠️ Extension fattura failed:', errMsg)
            toast.error(`Fattura estensione non generata: ${errMsg}`, { duration: 8000 })
          }
        } catch (invoiceError) {
          console.error('[handleConfirmExtend] ⚠️ Failed to generate extension fattura:', invoiceError)
        }
      }

      // Generate Nexi Pay by Link for extension
      if (extendData.extension_payment_status === 'nexi_pay_by_link' && additionalAmount > 0) {
        try {
          let customerPhone = extendingBooking.customer_phone || extendingBooking.booking_details?.customer?.phone
          const custEmail = extendingBooking.customer_email || extendingBooking.booking_details?.customer?.email
          const custName = extendingBooking.customer_name || extendingBooking.booking_details?.customer?.fullName || 'Cliente'

          if (!customerPhone) {
            const custId = extendingBooking.booking_details?.customer?.customerId || extendingBooking.booking_details?.customer_id
            if (custId) {
              const { data: cust } = await supabase.from('customers_extended').select('telefono').eq('id', custId).maybeSingle()
              if (cust?.telefono) customerPhone = cust.telefono
            }
          }

          const expirationHours = parseInt(extendData.link_expiration_hours) || 1
          const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: extendingBooking.id,
              amount: additionalAmount,
              customerEmail: custEmail || '',
              customerName: custName,
              description: `Estensione noleggio — ${custName}`,
              expirationHours,
              paymentPurpose: 'extension',
            }),
          })
          const linkData = await linkRes.json()

          if (linkRes.ok && linkData.paymentUrl) {
            // Store link on booking
            await supabase.from('bookings').update({
              booking_details: {
                ...updatedBookingDetails,
                nexi_payment_link: linkData.paymentUrl,
                nexi_order_id: linkData.orderId,
              }
            }).eq('id', extendingBooking.id)

            if (customerPhone) {
              const bookingRef = extendingBooking.id.substring(0, 8).toUpperCase()
              await fetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  customPhone: customerPhone,
                  templateKey: 'payment_link_customer',
                  templateVars: { '{customer_name}': custName, '{booking_id}': bookingRef, '{total}': additionalAmount.toFixed(2), '{payment_link}': linkData.paymentUrl, '{expiry}': `${expirationHours} ${expirationHours === 1 ? 'ora' : 'ore'}` }
                })
              })
            }

            // Skip navigator.clipboard — Safari throws NotAllowedError after the
            // awaited WhatsApp fetch because the user-gesture context is lost.
            toast.success(`Pay by Link estensione inviato! €${additionalAmount.toFixed(2)} (validità ${expirationHours}h)`)
          } else {
            toast.error('Errore Pay by Link: ' + (linkData.error || 'Errore'))
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (linkErr: any) {
          console.error('[handleConfirmExtend] Pay by Link error:', linkErr)
          toast.error('Errore Pay by Link: ' + linkErr.message)
        }
      }

      // Close modal
      setShowExtendModal(false)
      setExtendingBooking(null)

      // Refresh data
      await loadData()

    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('[handleConfirmExtend] Error:', error)
      alert('Errore: ' + (_errMsg || 'Errore sconosciuto'))
    } finally {
      setIsExtending(false)
    }
  }

  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitLockRef = useRef(false)
  const [confirmBooking, setConfirmBooking] = useState(false)

  async function processBookingSubmission(skipValidation = false, overrideCustomerId?: string) {
    logger.log('[processBookingSubmission] 🚀 STARTING SUBMISSION PROCESS', { skipValidation, overrideCustomerId })

    if (isSubmitting) return

    // VALIDATION LOGIC
    if (!skipValidation) {
      let missing: string[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

          // ===== LIMITATION CHECKS: Driver tier (new customer) =====
          // Note: data_rilascio_patente not collected in new customer form,
          // so license_too_recent check runs after customer is saved to DB (existing customer path on retry)
          if (newCustomerData.data_nascita && customerTier?.tier === 'BLOCKED' && !hasOverride('driver_blocked')) {
            requestOverride('driver_blocked', `Cliente non idoneo al noleggio: ${customerTier.reason}`)
            return
          }
          if (customerTier?.tier === 'TIER_1' && formData.deposit_status === 'no_cauzione' && !hasOverride('tier1_no_cauzione')) {
            requestOverride('tier1_no_cauzione', 'No Cauzione non disponibile per clienti Fascia B (età 21-25 o patente 3-4 anni).')
            return
          }
          if (formData.deposit_status === 'no_cauzione' && formData.insurance_option === 'RCA' && !hasOverride('no_cauzione_rca_only')) {
            requestOverride('no_cauzione_rca_only', 'No Cauzione richiede una Kasko attiva. Seleziona una Kasko prima di procedere.')
            return
          }
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
        logger.log('[processBookingSubmission] Generated new customer ID:', newCustomerId)

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

        // Fetch fresh customer data - try multiple methods
        logger.log('[processBookingSubmission] Looking up customer:', targetCustomerId)

        // First, try to find in local customers array (includes customers from bookings)
        const localCustomer = customers.find(c => c.id === targetCustomerId)
        logger.log('[processBookingSubmission] Local customer found:', localCustomer?.full_name || 'NOT FOUND')

        // Then try database lookup
        logger.log('[processBookingSubmission] 🔍 Querying customers_extended for ID:', targetCustomerId)
        const queryResult = await supabase
          .from('customers_extended')
          .select('*')
          .eq('id', targetCustomerId)
          .limit(1)
        let customerData = queryResult.data
        const customerError = queryResult.error

        // Track if we found customer directly in DB
        let foundDirectlyInDB = customerData && customerData.length > 0
        logger.log('[processBookingSubmission] Direct DB lookup result:', {
          found: foundDirectlyInDB,
          dataLength: customerData?.length || 0,
          error: customerError?.message || 'none'
        })

        // If not found by ID, try by email from local customer
        if ((!customerData || customerData.length === 0) && localCustomer?.email) {
          logger.log('[processBookingSubmission] Trying lookup by email:', localCustomer.email)
          const { data: emailData } = await supabase
            .from('customers_extended')
            .select('*')
            .eq('email', localCustomer.email)
            .limit(1)
          if (emailData && emailData.length > 0) {
            customerData = emailData
            foundDirectlyInDB = true
            logger.log('[processBookingSubmission] ✅ Found by email:', emailData[0].id)
          }
        }

        // If not found by email, try by phone
        if ((!customerData || customerData.length === 0) && localCustomer?.phone) {
          let normPhone = localCustomer.phone.replace(/[\s\-+()]/g, '')
          if (normPhone.startsWith('00')) normPhone = normPhone.substring(2)
          if (normPhone.length === 10) normPhone = '39' + normPhone
          logger.log('[processBookingSubmission] Trying lookup by phone:', normPhone)
          const { data: phoneData } = await supabase
            .from('customers_extended')
            .select('*')
            .eq('telefono', normPhone)
            .limit(1)
          if (phoneData && phoneData.length > 0) {
            customerData = phoneData
            foundDirectlyInDB = true
            logger.log('[processBookingSubmission] ✅ Found by phone:', phoneData[0].id)
          }
        }

        if (customerError && customerError.code !== 'PGRST116') {
          console.error('[processBookingSubmission] Customer lookup error:', customerError)
          const errorMsg = customerError.message || JSON.stringify(customerError, null, 2)
          alert(
            `Errore nel caricamento del cliente:\n\n${errorMsg}\n\n` +
            `ID Cliente: ${targetCustomerId}\n\n` +
            'Riprova o contatta il supporto tecnico.'
          )
          return
        }

        let customer = customerData?.[0]

        // If still not found in DB but we have local data, use that with a warning
        if (!customer && localCustomer) {
          logger.log('[processBookingSubmission] ⚠️ Customer not in DB, using local data from autocomplete')
          customer = {
            id: localCustomer.id,
            full_name: localCustomer.full_name,
            email: localCustomer.email,
            telefono: localCustomer.phone,
            tipo_cliente: 'persona_fisica', // Default
            nome: localCustomer.full_name?.split(' ')[0] || '',
            cognome: localCustomer.full_name?.split(' ').slice(1).join(' ') || ''
          }
        }

        if (customer) {
          logger.log('[processBookingSubmission] ✅ Customer resolved:', {
            id: customer.id,
            nome: customer.nome,
            cognome: customer.cognome,
            full_name: customer.full_name,
            email: customer.email,
            foundDirectlyInDB
          })

          // CRITICAL FIX: Ensure customer ID is always present in tempCustData
          tempCustData = {
            ...customer,
            id: customer.id || targetCustomerId
          }

          // Validate only essential fields for booking creation
          // Contract/fattura generation will handle its own validation when needed
          const isAzienda = customer.tipo_cliente === 'azienda'

          if (isAzienda) {
            if (!customer.partita_iva && !customer.codice_fiscale) missing.push('partita_iva')
            if (!customer.denominazione && !customer.ragione_sociale) missing.push('denominazione')
          } else {
            if (!customer.nome) missing.push('nome')
            if (!customer.cognome) missing.push('cognome')

            // ===== LIMITATION CHECKS: License age & driver tier =====
            const patenteDate = customer.data_rilascio_patente || customer.metadata?.patente?.rilascio
            if (patenteDate) {
              const licYears = calculateLicenseYears(patenteDate)
              if (licYears < 3 && !hasOverride('license_too_recent')) {
                requestOverride('license_too_recent', 'Patente rilasciata da meno di 3 anni. Il cliente non può noleggiare.')
                return
              }
            }
            if (customer.data_nascita && patenteDate) {
              const age = calculateAge(customer.data_nascita)
              const licYears = calculateLicenseYears(patenteDate)
              const tier = classifyDriverTier(age, licYears)
              if (tier.tier === 'BLOCKED' && !hasOverride('driver_blocked')) {
                requestOverride('driver_blocked', `Cliente non idoneo al noleggio: ${tier.reason}`)
                return
              }
              if (tier.tier === 'TIER_1' && formData.deposit_status === 'no_cauzione' && !hasOverride('tier1_no_cauzione')) {
                requestOverride('tier1_no_cauzione', 'No Cauzione non disponibile per clienti Fascia B (età 21-25 o patente 3-4 anni).')
                return
              }
            }
            if (formData.deposit_status === 'no_cauzione' && formData.insurance_option === 'RCA' && !hasOverride('no_cauzione_rca_only')) {
              requestOverride('no_cauzione_rca_only', 'No Cauzione richiede una Kasko attiva. Seleziona una Kasko prima di procedere.')
              return
            }
          }

          if (missing.length > 0) {
            logger.log('[processBookingSubmission] ⚠️ Missing fields for contract/fattura:', missing)
          } else {
            logger.log('[processBookingSubmission] ✅ All required fields present')
          }
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
              logger.warn('[processBookingSubmission] Detected non-UUID ID:', safeId, 'Generating new valid UUID.')
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
            // Patente not required for azienda
            missing = ['nome', 'cognome', 'codice_fiscale', 'data_nascita', 'luogo_nascita', 'indirizzo', 'citta_residenza']
            if (tempCustData.tipo_cliente !== 'azienda') missing.push('patente')
            if (!tempCustData.email) missing.push('email')
            if (!tempCustData.telefono) missing.push('telefono')

            logger.log('[processBookingSubmission] Customer exists in bookings but not in customers_extended. Will create new profile with missing fields:', missing)
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
        logger.log('[processBookingSubmission] 🚨 Missing data detected! Opening NewClientModal for fields:', missing)

        // CRITICAL VALIDATION: Ensure tempCustData has a valid ID before opening modal
        if (!tempCustData || !tempCustData.id) {
          console.error('[processBookingSubmission] CRITICAL ERROR: tempCustData missing ID!', {
            tempCustData,
            targetCustomerId,
            newCustomerMode,
            formData_customer_id: formData.customer_id
          })

          alert(
            'ERRORE INTERNO: ID Cliente Mancante\n\n' +
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

        logger.log('[processBookingSubmission] ✅ Customer ID validated:', tempCustData.id)
        logger.log('[processBookingSubmission] 🛑 BLOCKING booking creation - opening NewClientModal for completion')

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
      logger.log('[processBookingSubmission] ⚠️ Modal is open, aborting booking creation')
      setIsSubmitting(false)
      return
    }

    // ===== VALIDATION PASSED - PROCEEDING WITH BOOKING CREATION =====
    logger.log('[processBookingSubmission] ✅ All validation passed, proceeding with booking creation')
    logger.log('[processBookingSubmission] Customer ID:', formData.customer_id || 'new customer')

    // Call the original submit logic (embedded here or separate)

    // Synchronous re-entry guard: React state updates are async, so a rapid
    // second click lands here before the first call has flipped isSubmitting.
    // The ref flips synchronously on the same tick, so the second call bails.
    if (submitLockRef.current || isSubmitting) return
    submitLockRef.current = true

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
            'CAMPI MANCANTI\n\n' +
            'I seguenti campi sono obbligatori:\n\n' +
            missingFields.map(f => `- ${f}`).join('\n') +
            '\n\nCompila tutti i campi richiesti prima di salvare la prenotazione.'
          )
        }, 100)
        setIsSubmitting(false)
        return
      }

      // ===== VALIDATION: Check pickup is not in the past (only for NEW bookings) =====
      if (!editingId) {
        const nowRome = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }))
        const pickupCheck = new Date(`${formData.pickup_date}T${formData.pickup_time}:00`)
        if (pickupCheck < nowRome && !hasOverride('pickup_in_past')) {
          requestOverride('pickup_in_past', 'La data e ora di ritiro è nel passato. Serve autorizzazione per procedere.')
          setIsSubmitting(false)
          return
        }
      }

      // ===== VALIDATION: Check dates are valid before parsing =====
      // Test parse the dates first to ensure they're valid
      const testPickupDate = new Date(`${formData.pickup_date}T${formData.pickup_time}:00`)
      const testReturnDate = new Date(`${formData.return_date}T${formData.return_time}:00`)

      if (isNaN(testPickupDate.getTime()) || isNaN(testReturnDate.getTime())) {
        setTimeout(() => {
          alert(
            'DATE NON VALIDE\n\n' +
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
            'DATE NON VALIDE\n\n' +
            'La data di riconsegna deve essere successiva alla data di ritiro.\n\n' +
            `Ritiro: ${testPickupDate.toLocaleDateString('it-IT')} ${testPickupDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}\n` +
            `Riconsegna: ${testReturnDate.toLocaleDateString('it-IT')} ${testReturnDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}\n\n` +
            'Modifica le date e riprova.'
          )
        }, 100)
        setIsSubmitting(false)
        return
      }

      // ===== VALIDATION: Home Delivery fields =====
      if (formData.delivery_enabled) {
        const deliveryMissing: string[] = []
        if (!formData.delivery_street.trim()) deliveryMissing.push('Via e numero (consegna)')
        if (!formData.delivery_city.trim()) deliveryMissing.push('Città (consegna)')
        if (!formData.delivery_zip.trim()) deliveryMissing.push('CAP (consegna)')
        if (!formData.delivery_province.trim()) deliveryMissing.push('Provincia (consegna)')
        if (!formData.delivery_fee || parseFloat(formData.delivery_fee) < 0) deliveryMissing.push('Costo consegna')
        if (deliveryMissing.length > 0) {
          setTimeout(() => {
            alert(
              'CONSEGNA A DOMICILIO - CAMPI MANCANTI\n\n' +
              'Compila i seguenti campi:\n\n' +
              deliveryMissing.map(f => `- ${f}`).join('\n')
            )
          }, 100)
          setIsSubmitting(false)
          return
        }
      }

      // ===== VALIDATION: Home Pickup fields =====
      if (formData.pickup_enabled) {
        const pickupMissing: string[] = []
        if (!formData.pickup_street.trim()) pickupMissing.push('Via e numero (ritiro)')
        if (!formData.pickup_city.trim()) pickupMissing.push('Città (ritiro)')
        if (!formData.pickup_zip.trim()) pickupMissing.push('CAP (ritiro)')
        if (!formData.pickup_province.trim()) pickupMissing.push('Provincia (ritiro)')
        if (!formData.pickup_fee || parseFloat(formData.pickup_fee) < 0) pickupMissing.push('Costo ritiro')
        if (pickupMissing.length > 0) {
          setTimeout(() => {
            alert(
              'RITIRO A DOMICILIO - CAMPI MANCANTI\n\n' +
              'Compila i seguenti campi:\n\n' +
              pickupMissing.map(f => `- ${f}`).join('\n')
            )
          }, 100)
          setIsSubmitting(false)
          return
        }
      }

      // ===== VALIDATION: Cauzione Auto — targa must be looked up =====
      if (formData.cauzione_auto) {
        const cauzioneMissing: string[] = []
        if (!formData.cauzione_targa || formData.cauzione_targa.length < 5) {
          cauzioneMissing.push('Targa Veicolo Cauzione')
        }
        if (!formData.cauzione_targa_brand || !formData.cauzione_targa_year) {
          cauzioneMissing.push('Cerca targa (clicca "Cerca" per verificare il veicolo)')
        }
        if (cauzioneMissing.length > 0) {
          setTimeout(() => {
            alert(
              'CAUZIONE AUTO - CAMPI MANCANTI\n\n' +
              'Per utilizzare "Auto come Cauzione" devi:\n\n' +
              '1. Inserire la targa del veicolo\n' +
              '2. Cliccare "Cerca" per verificare che il veicolo sia dal 2020 in poi\n\n' +
              'Campi mancanti:\n' +
              cauzioneMissing.map(f => `- ${f}`).join('\n')
            )
          }, 100)
          setIsSubmitting(false)
          return
        }
      }

      // ===== AVAILABILITY ENGINE VALIDATION =====
      // Blocks same-car 75-min buffer AND the 15-min cross-vehicle handover gap.
      // Admin can override both via director OTP (slot_unavailable).
      // SKIP when EDITING an existing booking or when showAllVehicles is forced.
      if (formData.vehicle_id && !editingId && !showAllVehicles) {
        const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)

        if (selectedVehicle) {
          const allBookingsForCheck = [...bookings, ...carWashBookings]

          logger.log('[AVAILABILITY DEBUG] Checking for new booking, vehicle:', selectedVehicle.display_name)

          const availabilityResult = isVehicleAvailable(
            selectedVehicle,
            formData.pickup_date,
            formData.return_date,
            formData.pickup_time,
            formData.return_time,
            allBookingsForCheck,
            undefined
          )

          if (!availabilityResult.available && !hasOverride('slot_unavailable')) {
            requestOverride('slot_unavailable', availabilityResult.reason || 'Slot non disponibile')
            setIsSubmitting(false)
            return
          }

          logger.log('✅ Vehicle availability check passed')
        }
      } else if (editingId) {
        logger.log('✅ Skipping availability check for booking extension (editingId:', editingId, ')')
      }

      // ===== SCHEDULING RULES VALIDATION =====
      // Enforce non-negotiable scheduling rules for DEPARTURE (pickup) and RETURN (dropoff)
      // SKIP this check when EDITING an existing booking - admin is extending/modifying their own booking
      const vehicle = vehicles.find(v => v.id === formData.vehicle_id)

      if (vehicle && !editingId) {
        logger.log('🔍 Validating scheduling rules for NEW rental booking...')
        logger.log(`  Vehicle: ${vehicle.display_name}`)
        logger.log(`  Pickup (DEPARTURE): ${testPickupDate.toISOString()}`)
        logger.log(`  Dropoff (RETURN): ${testReturnDate.toISOString()}`)

        const schedulingValidation = await validateRentalBooking(
          testPickupDate,
          testReturnDate,
          vehicle.id,
          vehicle.display_name,
          vehicle.plate || vehicle.targa || undefined,
          undefined
        )

        if (!schedulingValidation.isValid) {
          logger.warn('⚠️ Scheduling validation warning:', schedulingValidation.errors)
        }

        logger.log('✅ Scheduling validation passed')
      } else if (editingId) {
        logger.log('✅ Skipping scheduling validation for booking extension (editingId:', editingId, ')')
      }

      // Check for existing bookings on the same vehicle and dates (only for new bookings, not edits)
      if (!editingId) {
        const pickupDateTime = new Date(`${formData.pickup_date}T${formData.pickup_time}:00`)
        const returnDateTime = new Date(`${formData.return_date}T${formData.return_time}:00`)

        // Calculate buffer time (1h30 = 90 minutes)
        const BUFFER_MINUTES = 90
        const pickupWithBuffer = new Date(pickupDateTime.getTime() - BUFFER_MINUTES * 60 * 1000)

        // First, check if the vehicle is currently in the car wash
        const carWashPlate = vehicle?.plate || vehicle?.targa || ''
        let carWashQuery = supabase
          .from('bookings')
          .select('id, service_type, service_name, vehicle_name, appointment_date, appointment_time, pickup_date, dropoff_date')
          .eq('service_type', 'car_wash')
          .neq('status', 'cancelled')
          .or(`and(pickup_date.lte.${pickupDateTime.toISOString()},dropoff_date.gte.${pickupDateTime.toISOString()})`)
        if (carWashPlate) {
          carWashQuery = carWashQuery.eq('vehicle_plate', carWashPlate)
        } else if (vehicle?.id) {
          carWashQuery = carWashQuery.eq('vehicle_id', vehicle.id)
        }
        const { data: carWashBookings, error: carWashError } = await carWashQuery

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
              logger.log('⚠️ Car wash conflict detected, proceeding anyway')
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
          query = query.eq('vehicle_plate', vehicle.plate || vehicle.targa)
        } else if (vehicle?.id) {
          query = query.eq('vehicle_id', vehicle.id)
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
            const conflictReturn = new Date(conflictingBooking.dropoff_date)

            const isOverlap = pickupDateTime < conflictReturn && returnDateTime > new Date(conflictingBooking.pickup_date)
            const timeDiff = pickupDateTime.getTime() - conflictReturn.getTime()
            const isBufferViolation = timeDiff > 0 && (timeDiff / (1000 * 60)) < BUFFER_MINUTES

            if (isOverlap) {
              logger.log(`⚠️ Double booking conflict with DR7-${bookingId}, proceeding anyway`)
            } else if (isBufferViolation) {
              logger.log(`⚠️ Buffer violation with DR7-${bookingId}, proceeding anyway`)
            }
          }
        }
      }

      let customerId = overrideCustomerId || formData.customer_id || null
      let secondDriverId = formData.second_driver_id || null

      // If creating new second driver, create them in customers_extended table first
      // BUT FIRST check if an identical second driver already exists (prevent duplicates)
      if (formData.has_second_driver && newSecondDriverMode) {
        logger.log('[processBookingSubmission] Creating new customer for second driver...')
        try {
          // DEDUP CHECK for second driver: codice_fiscale, then email, then telefono (with phone normalization)
          let existingSecondDriver: { id: string } | null = null
          if (formData.second_driver_codice_fiscale?.trim()) {
            const { data } = await supabase
              .from('customers_extended')
              .select('id')
              .eq('codice_fiscale', formData.second_driver_codice_fiscale.trim())
              .maybeSingle()
            existingSecondDriver = data
          }
          if (!existingSecondDriver && formData.second_driver_email?.trim()) {
            const { data } = await supabase
              .from('customers_extended')
              .select('id')
              .eq('email', formData.second_driver_email.trim().toLowerCase())
              .maybeSingle()
            existingSecondDriver = data
          }
          if (!existingSecondDriver && formData.second_driver_phone?.trim()) {
            // Normalize phone before dedup lookup (same logic as save-customer)
            let normSDPhone = formData.second_driver_phone.replace(/[\s\-+()]/g, '')
            if (normSDPhone.startsWith('00')) normSDPhone = normSDPhone.substring(2)
            if (normSDPhone.length === 10) normSDPhone = '39' + normSDPhone
            const { data } = await supabase
              .from('customers_extended')
              .select('id')
              .eq('telefono', normSDPhone)
              .maybeSingle()
            existingSecondDriver = data
          }

          if (existingSecondDriver) {
            secondDriverId = existingSecondDriver.id
            logger.log('✅ Existing second driver found (dedup), reusing ID:', existingSecondDriver.id)
          } else {
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
            logger.log('✅ New second driver created:', newSecondDriver)
          }
        } catch (error) {
          console.error('Error creating second driver:', error)
          throw new Error('Failed to create second driver: ' + (error as Error).message)
        }
      }

      // If creating new customer, create them in customers_extended table
      // BUT FIRST check if an identical customer already exists (prevent duplicates)
      // Skip entirely if overrideCustomerId is provided (customer already created by NewClientModal)
      if (newCustomerMode && !overrideCustomerId) {
        try {
          // DEDUP CHECK: Look for existing customer by type-specific unique field, then email, then telefono (with phone normalization)
          let existingCustomer: { id: string } | null = null

          if (newCustomerData.tipo_cliente === 'persona_fisica' && newCustomerData.codice_fiscale?.trim()) {
            const { data } = await supabase
              .from('customers_extended')
              .select('id')
              .eq('codice_fiscale', newCustomerData.codice_fiscale.trim())
              .maybeSingle()
            existingCustomer = data
          } else if (newCustomerData.tipo_cliente === 'azienda' && newCustomerData.partita_iva?.trim()) {
            const { data } = await supabase
              .from('customers_extended')
              .select('id')
              .eq('partita_iva', newCustomerData.partita_iva.trim())
              .maybeSingle()
            existingCustomer = data
          } else if (newCustomerData.tipo_cliente === 'pubblica_amministrazione' && newCustomerData.codice_univoco_pa?.trim()) {
            const { data } = await supabase
              .from('customers_extended')
              .select('id')
              .eq('codice_univoco', newCustomerData.codice_univoco_pa.trim())
              .maybeSingle()
            existingCustomer = data
          }

          if (!existingCustomer && newCustomerData.email?.trim()) {
            const { data } = await supabase
              .from('customers_extended')
              .select('id')
              .ilike('email', newCustomerData.email.trim())
              .maybeSingle()
            existingCustomer = data
          }
          if (!existingCustomer && newCustomerData.telefono?.trim()) {
            // Normalize phone before dedup lookup (same logic as save-customer)
            let normNewPhone = newCustomerData.telefono.replace(/[\s\-+()]/g, '')
            if (normNewPhone.startsWith('00')) normNewPhone = normNewPhone.substring(2)
            if (normNewPhone.length === 10) normNewPhone = '39' + normNewPhone
            const { data } = await supabase
              .from('customers_extended')
              .select('id')
              .eq('telefono', normNewPhone)
              .maybeSingle()
            existingCustomer = data
          }
          // Last resort: check by nome + cognome (persona fisica only)
          if (!existingCustomer && newCustomerData.tipo_cliente === 'persona_fisica' && newCustomerData.nome?.trim() && newCustomerData.cognome?.trim()) {
            const { data } = await supabase
              .from('customers_extended')
              .select('id')
              .ilike('nome', newCustomerData.nome.trim())
              .ilike('cognome', newCustomerData.cognome.trim())
              .maybeSingle()
            existingCustomer = data
          }

          if (existingCustomer) {
            // Customer already exists -- reuse their ID instead of creating a duplicate
            customerId = existingCustomer.id
            logger.log('✅ Existing customer found (dedup), reusing ID:', existingCustomer.id)
          } else {
            // No existing customer found -- create new one
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            logger.log('✅ New customer created in customers_extended table:', newCustomer)
          }
        } catch (error) {
          console.error('Error creating customer:', error)
          throw new Error('Failed to create customer: ' + (error as Error).message)
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            ? (dbCustomer.ragione_sociale || dbCustomer.denominazione)
            : dbCustomer.tipo_cliente === 'pubblica_amministrazione'
              ? (dbCustomer.ente_o_ufficio || dbCustomer.ragione_sociale)
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
            logger.log(`Vehicle change: ${existingBooking.vehicle_name} -> ${vehicle.display_name}`)
          } else if (plateChanged && existingBooking.vehicle_plate) {
            logger.log(`✅ Plate change: ${existingBooking.vehicle_plate} -> ${vehicle.plate || 'N/A'}`)
          }
        }
      }

      // Validate that vehicle still exists and has consistent data
      if (vehicle) {
        logger.log('🔍 Vehicle consistency check:', {
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

      // Get location labels — use actual address for domicilio, not the dropdown placeholder
      const pickupLocationLabel = formData.pickup_location === 'domicilio'
        ? `${formData.delivery_street || ''}, ${formData.delivery_city || ''}${formData.delivery_zip ? ' ' + formData.delivery_zip : ''}${formData.delivery_province ? ' ' + formData.delivery_province : ''}`.trim().replace(/^,\s*/, '') || 'Consegna a domicilio'
        : LOCATIONS.find(l => l.value === formData.pickup_location)?.label || formData.pickup_location
      const dropoffLocationLabel = formData.dropoff_location === 'domicilio'
        ? `${formData.pickup_street || ''}, ${formData.pickup_city || ''}${formData.pickup_zip ? ' ' + formData.pickup_zip : ''}${formData.pickup_province ? ' ' + formData.pickup_province : ''}`.trim().replace(/^,\s*/, '') || 'Ritiro a domicilio'
        : LOCATIONS.find(l => l.value === formData.dropoff_location)?.label || formData.dropoff_location

      // SIMPLIFIED TIMEZONE HANDLING: Construct ISO strings directly
      // This ensures times entered in the admin panel are stored EXACTLY as entered
      // No complex timezone conversion needed - admin panel times are already in Europe/Rome

      // Helper function to get correct timezone offset for Europe/Rome (handles DST automatically)
      const getRomeOffset = (dateString: string): string => {
        // Use noon to avoid DST boundary issues
        const date = new Date(`${dateString}T12:00:00`)
        // Calculate offset by comparing UTC time with Rome local time
        const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
        const romeStr = date.toLocaleString('en-US', { timeZone: 'Europe/Rome' })
        const utcDate = new Date(utcStr)
        const romeDate = new Date(romeStr)
        const diffMinutes = Math.round((romeDate.getTime() - utcDate.getTime()) / 60000)
        const sign = diffMinutes >= 0 ? '+' : '-'
        const absMinutes = Math.abs(diffMinutes)
        const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0')
        const mins = String(absMinutes % 60).padStart(2, '0')
        return `${sign}${hours}:${mins}`
      }

      // Get the correct timezone offset for the pickup date
      const pickupOffset = getRomeOffset(formData.pickup_date)
      const returnOffset = getRomeOffset(formData.return_date)

      // Construct ISO strings with explicit timezone offset
      const pickupDateTime = `${formData.pickup_date}T${formData.pickup_time}:00${pickupOffset}`
      const returnDateTime = `${formData.return_date}T${formData.return_time}:00${returnOffset}`

      // Create Date objects from ISO strings
      const pickupDate = new Date(pickupDateTime)
      const returnDate = new Date(returnDateTime)

      // Debug logging to verify correct conversion
      logger.log('[Admin Booking] Timezone conversion:', {
        pickup: {
          input: `${formData.pickup_date} ${formData.pickup_time}`,
          offset: pickupOffset,
          iso: pickupDateTime,
          utc: pickupDate.toISOString()
        },
        return: {
          input: `${formData.return_date} ${formData.return_time}`,
          offset: returnOffset,
          iso: returnDateTime,
          utc: returnDate.toISOString()
        }
      })

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
        price_total: Math.round(eurToCents(formData.total_amount) // Convert to cents (base rental)
          + (formData.delivery_enabled ? eurToCents(formData.delivery_fee) : 0)
          + (formData.pickup_enabled ? eurToCents(formData.pickup_fee) : 0)),
        km_overage_fee: parseFloat(formData.km_overage_fee) || 0,
        currency: formData.currency.toUpperCase(),
        // Pay by Link bookings start as pending_payment/unpaid;
        // other payment methods start as confirmed/paid
        status: (!editingId && formData.payment_method === 'Nexi Pay by Link' && formData.payment_status !== 'paid')
          ? 'pending' : formData.status === 'pending_payment' ? 'pending' : (formData.status || 'confirmed'),
        payment_status: (!editingId && formData.payment_method === 'Nexi Pay by Link' && formData.payment_status !== 'paid')
          ? 'unpaid' : formData.payment_status,
        payment_method: formData.payment_method,
        customer_name: customerInfo?.full_name || 'N/A',
        customer_email: customerInfo?.email || null,
        customer_phone: customerInfo?.phone || null,
        booked_at: editingId ? undefined : new Date().toISOString(), // Don't update booked_at on edit
        booking_source: 'admin', // Mark as admin booking
        // payment_link_expires_at set after Nexi responds (via update)
        // Home Delivery & Pickup (top-level DB columns)
        delivery_enabled: formData.delivery_enabled,
        delivery_address: formData.delivery_enabled ? {
          street: formData.delivery_street,
          city: formData.delivery_city,
          zip: formData.delivery_zip,
          province: formData.delivery_province,
          notes: formData.delivery_notes
        } : null,
        delivery_fee: formData.delivery_enabled ? eurToCents(formData.delivery_fee) : 0,
        pickup_enabled: formData.pickup_enabled,
        pickup_address: formData.pickup_enabled ? {
          street: formData.pickup_street,
          city: formData.pickup_city,
          zip: formData.pickup_zip,
          province: formData.pickup_province,
          notes: formData.pickup_notes
        } : null,
        pickup_fee: formData.pickup_enabled ? eurToCents(formData.pickup_fee) : 0,
        booking_details: {
          // When editing, preserve metadata that the form doesn't manage
          // (extension history, contracts, deposit options, etc.)
          ...(editingId ? (() => {
            const existingBooking = bookings.find(b => b.id === editingId)
            const bd = existingBooking?.booking_details
            return bd ? {
              extension_history: bd.extension_history,
              extension_contracts: bd.extension_contracts,
              contract_generated_at: bd.contract_generated_at,
              depositOption: bd.depositOption,
              noDepositSurcharge: bd.noDepositSurcharge,
              // Preserve Nexi payment data
              nexi_payment_link: bd.nexi_payment_link,
              nexi_order_id: bd.nexi_order_id,
              nexi_transaction_id: bd.nexi_transaction_id,
              nexi_contract_id: bd.nexi_contract_id,
              nexi_paid_at: bd.nexi_paid_at,
              nexi_extension_paid_at: bd.nexi_extension_paid_at,
              paymentStatus: bd.paymentStatus,
              // Preserve danni & penali
              danni: bd.danni,
              penalties: bd.penalties,
              // Preserve reminder flags (set by trigger-reminders)
              deposit_reminder_sent: bd.deposit_reminder_sent,
              deposit_reminder_sent_at: bd.deposit_reminder_sent_at,
              day_before_reminder_sent: bd.day_before_reminder_sent,
              day_before_reminder_sent_at: bd.day_before_reminder_sent_at,
              pre_rental_offer_sent: bd.pre_rental_offer_sent,
              iban_request_sent: bd.iban_request_sent,
              // Preserve insurance field (read by invoice generator)
              insurance: bd.insurance,
            } : {}
          })() : {}),
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
          amountPaid: eurToCents(formData.amount_paid), // Store amount paid in cents
          source: 'admin_manual',
          // Driver Tier
          driver_tier: customerTier?.tier || null,
          driver_age: customerTier?.driverAge || null,
          driver_license_years: customerTier?.licenseYears || null,
          // Kasko & Deposit
          insuranceOption: formData.insurance_option,
          deposit: formData.deposit,
          deposit_status: formData.deposit_status,
          no_cauzione_surcharge_per_day: formData.deposit_status === 'no_cauzione' ? CFG_NO_CAUZIONE_PER_DAY : 0,
          // KM Limit
          km_limit: formData.unlimited_km ? 'Illimitati' : formData.km_limit,
          unlimited_km: formData.unlimited_km,
          // Centralina Pro: prezzo per-veicolo-categoria + per-fascia.
          // getUnlimitedKmPriceRes(vehicle, tier) legge rental_config.unlimited_km[category][tier]
          // invece del fallback globale CFG_UNLIMITED_KM (che ignora la categoria).
          unlimited_km_price_per_day: formData.unlimited_km
            ? getUnlimitedKmPriceRes(vehicles.find(v => v.id === formData.vehicle_id), customerTier?.tier)
            : null,
          // Second driver
          second_driver_fee_per_day: formData.has_second_driver && customerTier?.tier
            ? (customerTier.tier === 'TIER_2' ? CFG_SECOND_DRIVER.TIER_2 : CFG_SECOND_DRIVER.TIER_1)
            : null,
          // Experience Services & DR7 Flex
          experience_services: formData.experience_services,
          experience_cost: calculateExperienceCost(formData.experience_services, revenueSuggestion?.rentalDays || 1),
          dr7_flex: formData.dr7_flex,
          dr7_flex_price_per_day: formData.dr7_flex ? CFG_DR7_FLEX_PER_DAY : 0,
          // Cauzione Auto
          cauzione_auto: formData.cauzione_auto,
          cauzione_targa: formData.cauzione_auto ? formData.cauzione_targa : null,
          cauzione_veicolo: formData.cauzione_auto ? {
            targa: formData.cauzione_targa,
            brand: formData.cauzione_targa_brand,
            model: formData.cauzione_targa_model,
            year: formData.cauzione_targa_year,
          } : null,
          garante_veicolo: formData.cauzione_auto ? (() => {
            if (formData.cauzione_proprietario_tipo === 'guidatore') {
              // Duplicate from booking customer
              const cust = customers.find(c => c.id === formData.customer_id)
              return {
                tipo: 'guidatore',
                customer_id: formData.customer_id || null,
                nome: cust?.full_name?.split(' ').slice(0, -1).join(' ') || '',
                cognome: cust?.full_name?.split(' ').pop() || '',
              }
            }
            return {
              tipo: 'diverso',
              customer_id: formData.garante_customer_id || null,
              nome: formData.garante_nome,
              cognome: formData.garante_cognome,
              codice_fiscale: formData.garante_codice_fiscale,
              sesso: formData.garante_sesso,
              indirizzo: formData.garante_indirizzo,
              cap: formData.garante_cap,
              citta: formData.garante_citta,
              provincia: formData.garante_provincia,
              birth_date: formData.garante_birth_date,
              birth_place: formData.garante_birth_place,
              birth_provincia: formData.garante_birth_provincia,
              phone: formData.garante_phone,
              email: formData.garante_email,
            }
          })() : null,
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
          } : null,
          // Home Delivery & Pickup (backup in booking_details JSONB)
          delivery_enabled: formData.delivery_enabled,
          delivery_address: formData.delivery_enabled ? {
            street: formData.delivery_street,
            city: formData.delivery_city,
            zip: formData.delivery_zip,
            province: formData.delivery_province,
            notes: formData.delivery_notes
          } : null,
          delivery_fee: formData.delivery_enabled ? formData.delivery_fee : '0',
          pickup_enabled: formData.pickup_enabled,
          pickup_address: formData.pickup_enabled ? {
            street: formData.pickup_street,
            city: formData.pickup_city,
            zip: formData.pickup_zip,
            province: formData.pickup_province,
            notes: formData.pickup_notes
          } : null,
          pickup_fee: formData.pickup_enabled ? formData.pickup_fee : '0',
          notes: formData.notes || null,
          // Manually confirmed flag: prevents auto-cancel + shows red in calendar with customer name
          ...(confirmBooking ? {
            manually_confirmed: true,
            manually_confirmed_at: new Date().toISOString(),
          } : {}),
          // Revenue Management tracking
          ...(revenueSuggestion ? {
            revenue_suggested_price: revenueSuggestion.finalTotalEur,
            revenue_breakdown: revenueSuggestion.breakdown,
            revenue_daily_rate: revenueSuggestion.finalDailyRateEur,
            revenue_base_price: revenueSuggestion.selectedBaseRateEur,
            revenue_mode: revenueSuggestion.mode,
            revenue_base_source: revenueSuggestion.selectedBaseRateSource,
            operator_override: Math.abs(eurToCents(formData.total_amount || '0') - Math.round(revenueSuggestion.finalTotalEur * 100)) > 1
          } : {}),
          // Limitation override audit trail
          ...(getOverrideAuditSnapshot() ? {
            limitation_overrides: getOverrideAuditSnapshot()
          } : {})
        }
      }

      logger.log(editingId ? 'Updating rental booking' : 'Creating rental booking', 'with data:', bookingData)
      logger.log('💰 PRICE DEBUG: formData.total_amount =', JSON.stringify(formData.total_amount),
        '→ eurToCents =', eurToCents(formData.total_amount),
        '→ EUR =', (eurToCents(formData.total_amount) / 100).toFixed(2),
        '| price_total (with fees) =', bookingData.price_total,
        '→ EUR =', (bookingData.price_total / 100).toFixed(2))

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
        logger.log('Booking updated successfully:', insertedBooking)
        logAdminAction('edit_booking', 'booking', editingId, {
          ...buildBookingContext(insertedBooking),
          customer: insertedBooking?.customer_name || customerInfo?.full_name,
        })
      } else {
        // Create new booking - direct insert
        logger.log('Creating new booking...', showAllVehicles ? '(FORCE MODE)' : '')
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
        logger.log('Booking created successfully:', insertedBooking)
        logAdminAction('create_booking', 'booking', insertedBooking?.id, {
          ...buildBookingContext(insertedBooking),
          customer: insertedBooking?.customer_name || customerInfo?.full_name,
        })
      }

      // Generate Nexi Pay by Link only when the admin actually chose "Nexi Pay
      // by Link" as the payment method. For Contanti / Bonifico / Carta etc.
      // the customer will pay in person — sending a payment URL is wrong and
      // confusing.
      const isPendingForLink = formData.payment_status === 'pending' || formData.payment_status === 'unpaid' || formData.payment_status === 'partial'
      const isPayByLinkMethod = formData.payment_method === 'Nexi Pay by Link'
      if (!editingId && isPendingForLink && isPayByLinkMethod && insertedBooking) {
        try {
          // Use cents-based addition to avoid float drift, then convert to EUR
          // Subtract already paid amount for partial payments
          const fullTotalCents = eurToCents(formData.total_amount || '0')
            + (formData.delivery_enabled ? eurToCents(formData.delivery_fee || '0') : 0)
            + (formData.pickup_enabled ? eurToCents(formData.pickup_fee || '0') : 0)
          const alreadyPaidCents = formData.payment_status === 'partial' ? eurToCents(formData.amount_paid || '0') : 0
          const totalCents = Math.max(0, fullTotalCents - alreadyPaidCents)
          const totalEur = totalCents / 100

          if (totalEur <= 0) {
            toast.error('Totale non valido per generare il link di pagamento.')
            logger.warn('[PayByLink] Skipped — totalEur is 0. Check total_amount field.')
          } else {
            logger.log('[PayByLink] Generating link for booking', insertedBooking.id, 'amount €' + totalEur.toFixed(2))
            const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bookingId: insertedBooking.id,
                amount: totalEur,
                customerEmail: customerInfo?.email || '',
                customerName: customerInfo?.full_name || 'Cliente',
                description: `Noleggio DR7 - ${vehicle?.display_name || ''} - ${customerInfo?.full_name || ''}`,
                expirationHours: 1
              })
            })
            const linkData = await linkRes.json().catch(() => ({} as any))

            if (linkRes.ok && linkData.paymentUrl) {
              // Payment link tracking fields are now set by the backend (nexi-pay-by-link),
              // but we also update booking_details for backward compatibility
              await supabase.from('bookings').update({
                booking_details: {
                  ...insertedBooking.booking_details,
                  nexi_payment_link: linkData.paymentUrl,
                  nexi_order_id: linkData.orderId,
                  nexi_link_id: linkData.nexiLinkId || null,
                  payment_link_sent_at: linkData.sentAt,
                  payment_link_expires_at: linkData.expiresAt,
                  payment_link_created_at: linkData.linkCreatedAt || new Date().toISOString(),
                  payment_provider_expires_at: linkData.providerExpiresAt,
                }
              }).eq('id', insertedBooking.id)

              // Send payment link to customer via WhatsApp. Verify the send
              // actually went out — the endpoint returns 200 with skipped:true
              // when the Pro template is missing, and previously we showed a
              // "sent!" toast even on silent skip.
              const custPhone = customerInfo?.phone
              if (!custPhone) {
                toast(`Link generato ma cliente senza numero: ${linkData.paymentUrl}`, { duration: 12000 })
                logger.warn('[PayByLink] No customer phone — link not sent via WhatsApp')
              } else {
                const waRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    customPhone: custPhone,
                    templateKey: 'payment_link_customer',
                    templateVars: {
                      '{customer_name}': customerInfo?.full_name || 'Cliente',
                      '{nome}': (customerInfo?.full_name || 'Cliente').split(' ')[0] || 'Cliente',
                      '{booking_id}': insertedBooking.id.substring(0, 8).toUpperCase(),
                      '{booking_ref}': insertedBooking.id.substring(0, 8).toUpperCase(),
                      '{total}': totalEur.toFixed(2),
                      '{amount}': totalEur.toFixed(2),
                      '{importo}': totalEur.toFixed(2),
                      '{payment_link}': linkData.paymentUrl,
                      '{link}': linkData.paymentUrl,
                      '{expiry}': '1 ora',
                    }
                  })
                })
                const waJson = await waRes.json().catch(() => ({} as any))
                if (waJson?.skipped && waJson?.reason === 'pro_template_unavailable') {
                  toast.error('Link creato ma template "pro_richiesta_pagamento" mancante in Messaggi di Sistema Pro — messaggio NON inviato.', { duration: 10000 })
                  logger.error('[PayByLink] Template pro_richiesta_pagamento missing/disabled — WhatsApp skipped')
                } else if (!waRes.ok) {
                  toast.error(`Link creato ma invio WhatsApp fallito: ${waJson?.message || waRes.status}`, { duration: 10000 })
                } else {
                  toast.success('Pay by Link generato e inviato al cliente!')
                  logger.log('✅ Nexi Pay by Link sent:', linkData.paymentUrl)
                }
              }
            } else {
              const errMsg = linkData.error || linkData.message || `HTTP ${linkRes.status}`
              toast.error('Errore generazione Pay by Link: ' + errMsg, { duration: 10000 })
              logger.error('[PayByLink] nexi-pay-by-link failed:', errMsg, linkData)
            }
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (linkErr: any) {
          console.error('⚠️ Nexi Pay by Link error:', linkErr)
          toast.error('Errore Pay by Link: ' + (linkErr?.message || 'sconosciuto'), { duration: 10000 })
        }
      }

      // Create Google Calendar event — fire and forget (no await, runs in background)
      fetch('/.netlify/functions/create-calendar-event', {
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
          totalPrice: eurToCents(formData.total_amount) / 100,
          bookingId: insertedBooking?.id?.substring(0, 8)
        })
      })
        .then(() => logger.log('✅ Calendar event created successfully'))
        .catch(err => console.error('⚠️ Failed to create calendar event:', err))

      // Generate PDF invoice for car rental
      if (!editingId) { // Only for new bookings
        // Generate PDF invoice — fire and forget (runs in background)
        authFetch('/.netlify/functions/generate-invoice-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: insertedBooking?.id || '',
            bookingType: 'car_rental',
            customerName: customerInfo?.full_name || '',
            customerEmail: customerInfo?.email || '',
            customerPhone: customerInfo?.phone || '',
            items: [
              {
                description: `Noleggio ${vehicle?.display_name || 'Veicolo'}`,
                quantity: 1,
                unitPrice: eurToCents(formData.total_amount),
                total: eurToCents(formData.total_amount)
              },
              ...(formData.delivery_enabled ? [{
                description: 'Consegna a domicilio',
                quantity: 1,
                unitPrice: eurToCents(formData.delivery_fee),
                total: eurToCents(formData.delivery_fee)
              }] : []),
              ...(formData.pickup_enabled ? [{
                description: 'Ritiro a domicilio',
                quantity: 1,
                unitPrice: eurToCents(formData.pickup_fee),
                total: eurToCents(formData.pickup_fee)
              }] : [])
            ],
            subtotal: eurToCents(formData.total_amount)
              + (formData.delivery_enabled ? eurToCents(formData.delivery_fee) : 0)
              + (formData.pickup_enabled ? eurToCents(formData.pickup_fee) : 0),
            tax: 0,
            total: eurToCents(formData.total_amount)
              + (formData.delivery_enabled ? eurToCents(formData.delivery_fee) : 0)
              + (formData.pickup_enabled ? eurToCents(formData.pickup_fee) : 0),
            paymentStatus: formData.payment_status || 'pending',
            bookingDate: new Date().toISOString(),
            serviceDate: `${formData.pickup_date}T${formData.pickup_time}:00`,
            notes: `Ritiro: ${pickupLocationLabel}\nRiconsegna: ${dropoffLocationLabel}`
          })
        })
          .then(() => logger.log('✅ Invoice generated successfully'))
          .catch(err => console.error('⚠️ Failed to generate invoice:', err))
      }

      // Send WhatsApp notification for car rental
      // Always send on new booking (paid OR pending) + on any edit
      const paymentStatus = formData.payment_status || 'pending'
      {
      try {
        // Use pickupDateTime/returnDateTime which have correct Italy timezone offset
        // Fire and forget — don't block UI on WhatsApp sending
        fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking: {
              id: insertedBooking?.id || '',
              service_type: 'car_rental',
              isEdit: !!editingId,
              customer_name: customerInfo?.full_name || '',
              customer_email: customerInfo?.email || '',
              customer_phone: customerInfo?.phone || '',
              vehicle_name: vehicle?.display_name || '',
              pickup_date: pickupDateTime,
              dropoff_date: returnDateTime,
              pickup_location: pickupLocationLabel,
              insurance_option: 'KASKO_BASE',
              price_total: insertedBooking?.price_total || eurToCents(formData.total_amount),
              payment_status: paymentStatus,
              payment_method: formData.payment_method || '',
              deposit_amount: parseFloat(formData.deposit) || 0,
              km_overage_fee: parseFloat(formData.km_overage_fee) || 0,
              booking_details: {
                amountPaid: paymentStatus === 'paid' ? (insertedBooking?.price_total || eurToCents(formData.total_amount)) : 0,
                insuranceOption: 'KASKO_BASE',
                deposit: parseFloat(formData.deposit) || 0,
                deposit_status: formData.deposit_status,
                km_limit: formData.unlimited_km ? 'Illimitati' : formData.km_limit,
                unlimited_km: formData.unlimited_km,
                delivery_enabled: formData.delivery_enabled,
                delivery_address: formData.delivery_enabled ? {
                  street: formData.delivery_street,
                  city: formData.delivery_city,
                  zip: formData.delivery_zip,
                  province: formData.delivery_province
                } : null,
                delivery_fee: formData.delivery_enabled ? formData.delivery_fee : '0',
                pickup_enabled: formData.pickup_enabled,
                pickup_address: formData.pickup_enabled ? {
                  street: formData.pickup_street,
                  city: formData.pickup_city,
                  zip: formData.pickup_zip,
                  province: formData.pickup_province
                } : null,
                pickup_fee: formData.pickup_enabled ? formData.pickup_fee : '0',
                notes: formData.notes || null,
                depositOption: insertedBooking?.booking_details?.depositOption,
                noDepositSurcharge: insertedBooking?.booking_details?.noDepositSurcharge
              }
            }
          })
        }).then(() => logger.log('✅ WhatsApp admin notification sent'))
          .catch(err => console.error('⚠️ WhatsApp admin notification failed:', err))

        // Send customer confirmation — template varies by payment state
        const custPhone = customerInfo?.phone
        if (custPhone) {
          // A booking is "pending" (owes money) if status is pending, unpaid, or partial.
          // For partial, also verify amount_paid < total (otherwise admin meant "done").
          const totalForCheckCents = insertedBooking?.price_total || eurToCents(formData.total_amount || '0')
          const paidForCheckCents = formData.amount_paid ? eurToCents(formData.amount_paid) : 0
          const isPending = paymentStatus === 'pending'
            || paymentStatus === 'unpaid'
            || (paymentStatus === 'partial' && paidForCheckCents < totalForCheckCents)

          // Build template vars
          const pickupD = new Date(pickupDateTime)
          const dropoffD = new Date(returnDateTime)
          // Resolve insurance display name. Two ID formats live in this codebase:
          //   - Centralina Pro UIDs (random 8-char hash, e.g. "xtfcs9w3")
          //   - Legacy enums ("KASKO_BASE", "KASKO_BLACK", "KASKO_SIGNATURE",
          //     "KASKO_DR7", "DR7", "RCA")
          // Try Pro first; if that misses, map known legacy IDs; if even that
          // misses, humanize the raw value (KASKO_BASE → "Kasko Base").
          const insuranceKaskoOpts = vehicle ? getInsuranceOptions(vehicle, customerTier?.tier, configOverlay, rentalConfig) : []
          const insuranceMatch = insuranceKaskoOpts.find(k => k.id === formData.insurance_option)
          const legacyInsuranceMap: Record<string, string> = {
            RCA: 'RCA',
            KASKO_BASE: 'Kasko Base',
            KASKO_BLACK: 'Kasko Black',
            KASKO_SIGNATURE: 'Kasko Signature',
            KASKO_DR7: 'Kasko DR7',
            DR7: 'Kasko DR7',
          }
          const rawInsuranceId = formData.insurance_option || ''
          const insuranceDisplayName =
            insuranceMatch?.label
            || legacyInsuranceMap[rawInsuranceId]
            || rawInsuranceId
                .replace(/_/g, ' ')
                .toLowerCase()
                .replace(/\b\w/g, (c: string) => c.toUpperCase())
            || 'Kasko Base'
          const templateVars = {
            '{customer_name}': customerInfo?.full_name || 'Cliente',
            '{nome}': (customerInfo?.full_name || 'Cliente').split(' ')[0],
            '{booking_id}': insertedBooking?.id?.substring(0, 8).toUpperCase() || '',
            '{vehicle_name}': vehicle?.display_name || '',
            '{plate}': vehicle?.plate || '',
            '{pickup_date}': pickupD.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }),
            '{pickup_time}': pickupD.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }),
            '{dropoff_date}': dropoffD.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }),
            '{dropoff_time}': dropoffD.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }),
            '{pickup_location}': pickupLocationLabel || '',
            '{insurance}': insuranceDisplayName,
            '{deposit}': parseFloat(formData.deposit) > 0 ? `€${parseFloat(formData.deposit).toFixed(2)}` : '€0',
            '{km_info}': (() => {
              // 1. Form says unlimited → Illimitati
              if (formData.unlimited_km) return 'Illimitati'
              // 2. Freshly-saved booking has unlimited flag set → Illimitati (covers edits
              //    where the original booking was unlimited but form state got out of sync)
              if (insertedBooking?.booking_details?.unlimited_km === true) return 'Illimitati'
              // 3. Original pre-edit booking had unlimited — if the user didn't explicitly
              //    toggle it off in the form, preserve it rather than writing 0 km.
              if (editingId) {
                const orig = bookings.find(b => b.id === editingId)
                const od = orig?.booking_details as Record<string, unknown> | undefined
                const pkg = od?.kmPackage as Record<string, unknown> | undefined
                if (od?.unlimited_km === true
                  || od?.km_limit === 'Illimitati'
                  || pkg?.type === 'unlimited'
                  || Number(pkg?.includedKm) >= 9999) {
                  return 'Illimitati'
                }
              }
              const fromBooking = insertedBooking?.booking_details?.km_limit
              if (fromBooking === 'Illimitati') return 'Illimitati'
              const candidates = [
                typeof fromBooking === 'string' ? parseInt(fromBooking, 10) : (typeof fromBooking === 'number' ? fromBooking : NaN),
                typeof formData.km_limit === 'string' ? parseInt(formData.km_limit, 10) : NaN,
              ]
              let km = candidates.find(n => Number.isFinite(n) && n > 0)
              if (!km && vehicle && rentalConfig) {
                const kmCat = vehicle.category === 'urban' ? 'urban' : (vehicle.category || '_global')
                const rentalDaysForKm = Math.max(1, Math.ceil((new Date(returnDateTime).getTime() - new Date(pickupDateTime).getTime()) / (1000 * 60 * 60 * 24)))
                const computed = getKmIncluded(rentalConfig, rentalDaysForKm, kmCat)
                if (computed === 'unlimited') return 'Illimitati'
                if (typeof computed === 'number' && computed > 0) km = computed
              }
              return km ? `${km} km` : 'Illimitati'
            })(),
            '{total}': ((insertedBooking?.price_total || eurToCents(formData.total_amount)) / 100).toFixed(2),
            '{payment_method}': formData.payment_method || '',
            '{payment_status}': isPending ? 'Da saldare' : 'Pagato',
            '{notes}': formData.notes || '',
            // Payment link + expiry placeholders — only meaningful when the
            // rental_da_saldare_customer / payment_link_customer template is
            // chosen below. Pass '' when no link exists so the placeholder
            // doesn't leak into the message as "{payment_link}".
            '{payment_link}': '',
            '{link}': '',
            '{expiry}': '1 ora',
          }

          // Pick the right template. `null` means "do not send confirmation
          // WhatsApp from this block" — the pay-by-link block handles the
          // customer message in those cases. IMPORTANT: do NOT `return` from
          // here; the function still needs to run contract generation, the
          // EditDiffLink block, and the signing-link dispatch below.
          // - Edit with balance owed → null (EditDiffLink sends the pay-by-link)
          // - Edit fully paid → rental_new_customer
          // - Conferma Prenotazione ON → rental_new_customer
          // - New + pending → null (payment-link block above already sent link)
          // - New + paid → rental_new_customer
          let templateKey: string | null
          if (editingId) {
            if (isPending) {
              logger.log('[Save] Edit with remaining balance — skipping conferma-noleggio until fully paid (EditDiffLink will send pay-by-link)')
              templateKey = null
            } else {
              templateKey = 'rental_new_customer'
            }
          } else if (confirmBooking) {
            templateKey = 'rental_new_customer'
          } else if (isPending) {
            logger.log('[Save] New pending booking — payment-link block handled customer WhatsApp; skipping duplicate conferma')
            templateKey = null
          } else {
            templateKey = 'rental_new_customer'
          }

          if (templateKey) {
            const finalTemplateKey = templateKey
            fetch('/.netlify/functions/send-whatsapp-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customPhone: custPhone,
                templateKey: finalTemplateKey,
                templateVars,
              })
            }).then(() => logger.log(`✅ Customer WhatsApp sent (${finalTemplateKey}) to`, custPhone))
              .catch(err => console.error('⚠️ Customer WhatsApp failed:', err))
          }
        }
      } catch (whatsappError) {
        console.error('⚠️ Failed to send WhatsApp notification:', whatsappError)
        // Don't fail the whole booking if WhatsApp fails
      }
      } // end WhatsApp block

      // Sync cauzione (security deposit) record. Fire-and-forget but
      // surface failures: previously HTTP 4xx/5xx from the sync function
      // were swallowed because `.catch` only catches network errors, so
      // a missing customer_id / vehicle_id silently dropped the cauzione
      // and admin had no idea why "Da Incassare" stayed empty.
      const depositAmount = parseFloat(formData.deposit) || 0
      const depositPaid = formData.deposit_status === 'incassata'
      const isNoCauzione = formData.deposit_status === 'no_cauzione'
      ;(async () => {
        try {
          const syncRes = await fetch('/.netlify/functions/sync-booking-cauzione', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: insertedBooking.id,
              customerId: insertedBooking.user_id || formData.customer_id,
              vehicleId: insertedBooking.vehicle_id || formData.vehicle_id,
              returnDate: insertedBooking.dropoff_date || formData.return_date,
              depositAmount: depositAmount,
              paymentMethod: formData.payment_method || 'carta',
              depositPaid: depositPaid,
              depositStatus: formData.deposit_status
            })
          })
          if (!syncRes.ok) {
            const err = await syncRes.json().catch(() => ({} as any))
            console.error('⚠️ Cauzione sync HTTP error:', syncRes.status, err)
            // Only toast when admin actually expected a cauzione — staying
            // silent for no_cauzione bookings or zero-amount edits.
            if (depositAmount > 0 && !isNoCauzione) {
              toast.error(`Cauzione non creata: ${err.error || `HTTP ${syncRes.status}`}`, { duration: 8000 })
            }
            return
          }
          if (editingId) {
            const dataIncasso = formData.deposit_status === 'incassata' ? new Date().toISOString() : null
            await supabase
              .from('cauzioni')
              .update({ data_incasso: dataIncasso, updated_at: new Date().toISOString() })
              .eq('riferimento_contratto_id', insertedBooking.id)
          }
          if (depositAmount > 0 && !isNoCauzione && !editingId) {
            toast.success(`Cauzione €${depositAmount} creata in Da Incassare`, { duration: 4000 })
          }
          logger.log('✅ Cauzione synced successfully')
        } catch (err) {
          console.error('⚠️ Failed to sync cauzione:', err)
          if (depositAmount > 0 && !isNoCauzione) {
            toast.error('Errore di rete durante creazione cauzione — controlla la console', { duration: 8000 })
          }
        }
      })()

      // When MODIFYING a booking and the new totals leave a balance owed
      // (pending / unpaid / partial-with-remainder), DEFER contract regeneration
      // and the signing link until AFTER the customer pays the delta. The
      // nexi-payment-callback booking_topup branch regenerates the contract
      // and fires signature-init once payment lands. Previously the edit
      // immediately sent the updated contract for signing even though the
      // customer still owed money — the admin's ask was to wait for payment.
      //
      // Scope is deliberately narrow: only the edit-with-balance case defers.
      // Every other flow (new paid booking, new pending booking, edit that
      // is already fully paid, Segna Pagato) keeps its original behaviour so
      // yesterday's broader rework cannot reintroduce regressions.
      const editTotalCentsForGate = insertedBooking?.price_total || eurToCents(formData.total_amount || '0')
      const editPaidCentsForGate = formData.amount_paid ? eurToCents(formData.amount_paid) : 0
      const editHasBalanceOwed = !!editingId && (
        formData.payment_status === 'pending'
        || formData.payment_status === 'unpaid'
        || (formData.payment_status === 'partial' && editPaidCentsForGate < editTotalCentsForGate)
      )

      if (editHasBalanceOwed) {
        logger.log('[Auto-Gen] Edit leaves balance owed — deferring contract regen + signing link until payment callback')
      } else {
        // Generate Contract PDF — AWAIT so signing link below finds the contract
        logger.log('[Auto-Gen] Generating contract for booking:', insertedBooking.id, editingId ? '(edit - regenerating)' : '(new)')
        try {
          await handleGenerateContract(insertedBooking, false)
          logger.log('[Auto-Gen] ✅ Contract generated successfully')
        } catch (err) {
          console.error('[Auto-Gen] ⚠️ Failed to generate contract:', err)
        }
      }

      // Detect if payment status just changed from unpaid → paid (on edit)
      const justMarkedPaid = editingId
        && formData.payment_status === 'paid'
        && editingOriginalPaymentStatus !== 'paid'
        && editingOriginalPaymentStatus !== 'completed'
        && editingOriginalPaymentStatus !== 'succeeded'

      // Auto-generate fattura and send to SDI when payment status is "paid".
      // SKIP fattura for Credit Wallet payments — wallet credits are not invoiceable.
      // SKIP on edit if payment was ALREADY paid before (fattura already exists).
      // Only fire for a fresh booking, OR for an edit where payment JUST transitioned to paid.
      const shouldGenerateFattura = formData.payment_status === 'paid'
        && insertedBooking?.id
        && formData.payment_method !== 'Credit Wallet'
        && (!editingId || justMarkedPaid)
      if (shouldGenerateFattura) {
        // Always try to generate fattura — backend has fallbacks for missing data
        try {
          logger.log('[Auto-Gen] Generating fattura for paid booking:', insertedBooking.id, 'payment:', formData.payment_method)
          const invoiceRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: insertedBooking.id, includeIVA: true })
          })
          if (invoiceRes.ok) {
            logger.log('[Auto-Gen] ✅ Fattura generated and sent to SDI')
            toast.success('Fattura generata', { duration: 3000 })
          } else {
            const errData = await invoiceRes.json()
            const errMsg = errData.message || errData.error || 'Errore sconosciuto'
            logger.warn('[Auto-Gen] ⚠️ Fattura generation failed:', errMsg)

            // If failed due to missing customer data, show popup
            if (errMsg.toLowerCase().includes('dati') || errMsg.toLowerCase().includes('mancant') || errMsg.toLowerCase().includes('missing') || errMsg.toLowerCase().includes('required')) {
              try {
                const bookingForValidation = { ...insertedBooking, user_id: customerId, customer_email: customerInfo?.email, customer_phone: customerInfo?.phone } as unknown as Booking
                const invoiceMissing = (await validateCustomerData(bookingForValidation)).filter(f => f !== '__limitation_override_requested__')
                if (invoiceMissing.length > 0) {
                  const custId = customerId || insertedBooking.user_id || insertedBooking.booking_details?.customer?.customerId
                  let custData = {}
                  if (custId) {
                    try {
                      const resp = await authFetch(`/.netlify/functions/get-customer?id=${custId}`)
                      if (resp.ok) {
                        const result = await resp.json()
                        custData = result.customer || { id: custId }
                      }
                    } catch { custData = { id: custId } }
                  }
                  setMissingFields(invoiceMissing)
                  setTempCustomerData(custData)
                  setCurrentValidationBooking(bookingForValidation)
                  setValidationContext('invoice')
                  setShowMissingDataModal(true)
                }
              } catch { /* ignore validation errors */ }
            }
            toast.error(`Fattura non generata: ${errMsg}`, { duration: 8000 })
          }
        } catch (invoiceError) {
          console.error('[Auto-Gen] ⚠️ Failed to generate fattura:', invoiceError)
          toast.error('Errore generazione fattura: ' + (invoiceError instanceof Error ? invoiceError.message : 'sconosciuto'), { duration: 8000 })
        }
      }

      // ── Edit flow: send pay-by-link for any remaining balance ──
      // Covers every "customer still owes something" case after an edit:
      //   • Originally fully PAID + price went up     → link for (new - old)
      //   • Originally PARTIAL, admin left paid the   → link for (new - amount_paid)
      //     same 155 but raised total to 250             link for 95
      //   • Originally pending + still pending          → handled by the
      //     earlier "new booking pending" branch (not this one)
      // In short: owedCents = newTotal − alreadyPaid.
      // If owed > 0, fire a Nexi Pay by Link for owedCents.
      if (editingId && insertedBooking) {
        try {
          const originalBooking = bookings.find(b => b.id === editingId)
          const newTotalCents = insertedBooking?.price_total || eurToCents(formData.total_amount || '0')

          // Determine the "already paid" amount:
          //   1. form amount_paid when status is partial/paid (admin just set it)
          //   2. original booking_details — tries camelCase amountPaid FIRST
          //      (that's the shape the admin writes at save time, see line 4016),
          //      then snake_case amount_paid as a backup.
          //   3. original booking's price_total if original status was paid
          //   4. 0 fallback
          const origStatus = editingOriginalPaymentStatus
          const origWasPaid = origStatus === 'paid' || origStatus === 'succeeded' || origStatus === 'completed'
          const formPaidCents = formData.amount_paid ? eurToCents(formData.amount_paid) : 0
          const origBd = (originalBooking?.booking_details as Record<string, unknown> | undefined) || {}
          const origBdPaidCents = Number(origBd.amountPaid ?? origBd.amount_paid ?? 0) || 0
          const origTotalCents = originalBooking?.price_total || 0
          const alreadyPaidCents = formPaidCents > 0
            ? formPaidCents
            : (origBdPaidCents > 0 ? origBdPaidCents : (origWasPaid ? origTotalCents : 0))
          logger.log('[EditDiffLink] state:', {
            newTotalCents,
            formPaidCents,
            origBdPaidCents,
            origTotalCents,
            alreadyPaidCents,
            formPaymentStatus: formData.payment_status,
            origPaymentStatus: origStatus,
          })

          // Skip entirely if the admin has now marked the booking as fully paid
          // (no balance outstanding even if total went up — admin recorded the
          // extra as paid, so no link needed). Any other status (pending,
          // partial, unpaid) falls through and we compute the balance.
          if (formData.payment_status === 'paid' && formPaidCents >= newTotalCents) {
            logger.log('[EditDiffLink] Booking marked fully paid — skip pay-by-link')
          } else {

          const diffCents = newTotalCents - alreadyPaidCents
          const diffEur = diffCents / 100
          if (diffCents > 0) {
            logger.log(`[EditDiffLink] Owed €${diffEur.toFixed(2)} (new total €${(newTotalCents/100).toFixed(2)} − already paid €${(alreadyPaidCents/100).toFixed(2)}) — creating pay-by-link`)
            logger.log('[EditDiffLink] Price increased by €' + diffEur.toFixed(2) + ' — creating pay-by-link for the delta')
            const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bookingId: insertedBooking.id,
                amount: diffEur,
                customerEmail: customerInfo?.email || '',
                customerName: customerInfo?.full_name || 'Cliente',
                description: `Integrazione noleggio DR7 - ${vehicle?.display_name || ''} - ${customerInfo?.full_name || ''}`,
                expirationHours: 1,
                // Flag this link so the Nexi callback knows to treat the
                // payment as an INTEGRATION of an existing booking
                // (not a first-time payment). It will then:
                //   - add this amount to booking.amount_paid (not overwrite)
                //   - generate a fattura for just this amount (delta invoice)
                //   - regenerate + send the updated contract
                paymentPurpose: 'booking_topup',
              }),
            })
            const linkData = await linkRes.json().catch(() => ({} as any))
            if (linkRes.ok && linkData.paymentUrl) {
              const custPhone = customerInfo?.phone
              if (custPhone) {
                const bookingRef = insertedBooking.id.substring(0, 8).toUpperCase()
                const firstName = (customerInfo?.full_name || 'Cliente').split(' ')[0] || 'Cliente'
                const waRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    customPhone: custPhone,
                    templateKey: 'payment_link_customer',
                    templateVars: {
                      '{customer_name}': customerInfo?.full_name || firstName,
                      '{nome}': firstName,
                      '{booking_id}': bookingRef,
                      '{booking_ref}': bookingRef,
                      '{amount}': diffEur.toFixed(2),
                      '{total}': diffEur.toFixed(2),
                      '{importo}': diffEur.toFixed(2),
                      '{payment_link}': linkData.paymentUrl,
                      '{link}': linkData.paymentUrl,
                      '{expiry}': '1 ora',
                    },
                  }),
                })
                const waJson = await waRes.json().catch(() => ({} as any))
                if (waJson?.skipped) {
                  toast.error('Link integrazione creato ma template "pro_richiesta_pagamento" mancante — messaggio NON inviato.', { duration: 10000 })
                } else if (!waRes.ok) {
                  toast.error(`Link integrazione creato ma invio WhatsApp fallito: ${waJson?.message || waRes.status}`, { duration: 10000 })
                } else {
                  toast.success(`Link di integrazione per €${diffEur.toFixed(2)} inviato al cliente`)
                }
              } else {
                toast(`Link integrazione €${diffEur.toFixed(2)} creato ma cliente senza telefono: ${linkData.paymentUrl}`, { duration: 12000 })
              }
            } else {
              toast.error(`Errore creazione link integrazione: ${linkData.error || `HTTP ${linkRes.status}`}`, { duration: 10000 })
            }
          } else if (diffCents < 0) {
            logger.log('[EditDiffLink] Already paid > new total (€' + Math.abs(diffEur).toFixed(2) + ' overpaid) — no auto-refund; admin must handle manually')
          } else {
            logger.log('[EditDiffLink] No balance outstanding after edit — no link needed')
          }
          } // end else (not fully paid)
        } catch (err) {
          console.error('[EditDiffLink] Failed:', err)
          toast.error(`Errore link integrazione: ${err instanceof Error ? err.message : 'sconosciuto'}`, { duration: 8000 })
        }
      }

      // Auto-send contract for signature via WhatsApp.
      // Send when the booking is (or was) actually paid — we must NOT push a
      // fresh signing link to a customer who has never paid (covered by the
      // pay-by-link message from EditDiffLink / the Nexi topup callback).
      // Cases that trigger:
      //   - formData.payment_status ∈ {paid, completed, succeeded}
      //       → new paid booking, or edit that stays paid, or transition to paid.
      //   - Edit of a PREVIOUSLY paid booking (even if admin now saves as
      //     Da Saldare to ask for more money): the original customer already
      //     signed the old terms, so they need the updated contract. The
      //     pay-by-link handles the additional payment separately.
      // Cases that DON'T trigger:
      //   - New Da Saldare booking (customer has never paid — wait for payment).
      //   - Edit of a Da Saldare booking that stays Da Saldare.
      const PAID_STATUSES = ['paid', 'completed', 'succeeded']
      const currentlyPaid = PAID_STATUSES.includes(formData.payment_status || '')
      const wasOriginallyPaid = !!editingId
        && PAID_STATUSES.includes(editingOriginalPaymentStatus || '')
      const shouldSendSigningLink = !!insertedBooking?.id
        && !editHasBalanceOwed  // defer signing link until after payment on edits with balance
        && (currentlyPaid || wasOriginallyPaid)
      if (shouldSendSigningLink) {
        try {
          // Fetch the contract that was just generated for this booking
          const { data: contractForSig } = await supabase
            .from('contracts')
            .select('id, pdf_url, customer_email, booking_id')
            .eq('booking_id', insertedBooking.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (contractForSig?.id && contractForSig?.pdf_url) {
            logger.log('[Auto-Gen] Sending contract for signature via WhatsApp:', contractForSig.id)
            const sigRes = await fetch('/.netlify/functions/signature-init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contractId: contractForSig.id, bookingId: insertedBooking.id })
            })
            if (sigRes.ok) {
              logger.log('[Auto-Gen] ✅ Signing link sent via WhatsApp')
              if (editingId) toast.success('Nuovo contratto inviato per firma', { duration: 4000 })
              // Garante signing link is now handled by signature-init (multi-signer support)
            } else {
              const sigErr = await sigRes.json()
              logger.warn('[Auto-Gen] ⚠️ Signature init failed:', sigErr.error || sigErr)
              toast.error(`Link firma non inviato: ${sigErr.error || 'Errore sconosciuto'}`, { duration: 8000 })
            }
          } else {
            // Surface this to the admin on edit — the expectation is that saving a
            // modification regenerates and resends the contract. If the contract
            // row isn't available yet (generate-contract above failed or returned
            // empty), the admin needs to know so they can retry manually.
            logger.warn('[Auto-Gen] ⚠️ No contract found for booking, skipping signature-init')
            if (editingId) {
              toast.error('Contratto modificato non trovato — usa il tasto "Rigenera contratto" e poi "Invia contratto" per rispedirlo.', { duration: 10000 })
            }
          }
        } catch (sigError) {
          console.error('[Auto-Gen] ⚠️ Failed to send signing link:', sigError)
          if (editingId) {
            toast.error(`Errore invio contratto: ${sigError instanceof Error ? sigError.message : 'sconosciuto'}`, { duration: 8000 })
          }
        }
      }

      setShowForm(false)
      setEditingId(null)
      setNewCustomerMode(false)
      setConfirmBooking(false)
      resetForm()
      await loadData()

      await consumeAllOverrides(insertedBooking?.id)
      toast.success(editingId ? 'Prenotazione aggiornata!' : 'Prenotazione creata!')
    } catch (error) {
      console.error('Failed to save reservation:', error)
      alert('Failed to save reservation: ' + (error as Error).message)
    } finally {
      setIsSubmitting(false)
      submitLockRef.current = false
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    processBookingSubmission(false)
  }

  function resetForm() {
    setCustomerTier(null)
    setFormData({
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
      km_overage_fee: '', // si popola da Centralina quando si seleziona il veicolo
      payment_status: 'pending',
      payment_method: 'Nexi Pay by Link',
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
      deposit_status: 'da_incassare' as 'da_incassare' | 'incassata' | 'no_cauzione',
      deposit_option_id: '',
      unlimited_km: false,
      km_limit: DEFAULT_KM_LIMIT,
      // Home Delivery & Pickup
      delivery_enabled: false,
      delivery_street: '',
      delivery_city: '',
      delivery_zip: '',
      delivery_province: '',
      delivery_notes: '',
      delivery_fee: '0',
      pickup_enabled: false,
      pickup_street: '',
      pickup_city: '',
      pickup_zip: '',
      pickup_province: '',
      pickup_notes: '',
      pickup_fee: '0',
      notes: '',
      // Experience Services & DR7 Flex
      experience_services: {},
      dr7_flex: false,
      // Cauzione Auto (Vehicle as Security Deposit)
      cauzione_auto: false,
      cauzione_targa: '',
      cauzione_targa_year: '',
      cauzione_targa_brand: '',
      cauzione_targa_model: '',
      cauzione_proprietario_tipo: 'guidatore' as 'guidatore' | 'diverso',
      garante_customer_id: '',
      garante_nome: '',
      garante_cognome: '',
      garante_codice_fiscale: '',
      garante_sesso: '',
      garante_indirizzo: '',
      garante_cap: '',
      garante_citta: '',
      garante_provincia: '',
      garante_birth_date: '',
      garante_birth_place: '',
      garante_birth_provincia: '',
      garante_phone: '',
      garante_email: '',
    })
    setNewCustomerData({
      tipo_cliente: 'persona_fisica',
      nome: '',
      cognome: '',
      codice_fiscale: '',
      sesso: '',
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
            <Button onClick={() => { resetForm(); setEditingId(null); newSession('booking_create'); setShowForm(true) }} className="flex-1 sm:flex-none text-sm sm:text-base">
              <span className="hidden sm:inline">+ Nuova Prenotazione</span>
              <span className="sm:hidden">+ Nuova</span>
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <Input
            label="Cerca per codice, nome, email, telefono, targa o veicolo"
            placeholder="Cerca per codice prenotazione, nome, email, telefono, targa o veicolo..."
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
              logger.log('[ReservationsTab] NewClientModal finished. Resuming booking with:', newClientId)
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
              user_id: selectedBookingForPenalty.user_id || undefined,
              km_overage_fee: selectedBookingForPenalty.km_overage_fee,
              booking_details: selectedBookingForPenalty.booking_details || undefined,
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

        {/* Danni Modal */}
        {selectedBookingForDanni && (
          <DanniModal
            isOpen={danniModalOpen}
            booking={{
              id: selectedBookingForDanni.id,
              customer_name: selectedBookingForDanni.customer_name || 'Cliente',
              customer_id: selectedBookingForDanni.booking_details?.customer?.customerId || selectedBookingForDanni.booking_details?.customer_id || undefined,
              user_id: selectedBookingForDanni.user_id || undefined,
              customer_email: selectedBookingForDanni.customer_email || selectedBookingForDanni.booking_details?.customer?.email || undefined,
              customer_phone: selectedBookingForDanni.customer_phone || selectedBookingForDanni.booking_details?.customer?.phone || undefined
            }}
            onClose={() => {
              setDanniModalOpen(false)
              setSelectedBookingForDanni(null)
            }}
            onSuccess={() => {
              loadData()
            }}
            onEditCustomer={(customerId) => {
              openEditCustomer(customerId)
              setDanniModalOpen(false)
            }}
          />
        )}

        {/* Combined Danni & Penali Modal */}
        {selectedBookingForDanniPenali && (
          <DanniPenaliModal
            isOpen={danniPenaliModalOpen}
            initialTab={danniPenaliInitialTab}
            booking={{
              id: selectedBookingForDanniPenali.id,
              customer_name: selectedBookingForDanniPenali.customer_name || 'Cliente',
              customer_id: selectedBookingForDanniPenali.booking_details?.customer?.customerId || selectedBookingForDanniPenali.booking_details?.customer_id || undefined,
              user_id: selectedBookingForDanniPenali.user_id || undefined,
              customer_email: selectedBookingForDanniPenali.customer_email || selectedBookingForDanniPenali.booking_details?.customer?.email || undefined,
              customer_phone: selectedBookingForDanniPenali.customer_phone || selectedBookingForDanniPenali.booking_details?.customer?.phone || undefined,
              vehicle_name: selectedBookingForDanniPenali.vehicle_name || undefined,
              km_overage_fee: selectedBookingForDanniPenali.km_overage_fee,
              booking_details: selectedBookingForDanniPenali.booking_details || undefined,
            }}
            onClose={() => {
              setDanniPenaliModalOpen(false)
              setSelectedBookingForDanniPenali(null)
            }}
            onSuccess={() => {
              loadData()
            }}
            onEditCustomer={(customerId) => {
              openEditCustomer(customerId)
              setDanniPenaliModalOpen(false)
            }}
          />
        )}

        {/* Limitation Override Modal (OTP director approval) */}
        <LimitationOverrideModal
          isOpen={limitationState.isOpen}
          limitationCode={limitationState.limitationCode}
          limitationMessage={limitationState.limitationMessage}
          actionContext={limitationState.actionContext}
          draftSessionId={draftSessionId}
          flowType={flowType}
          onClose={closeLimitation}
          onCancel={() => {
            cancelLimitation()
            resetForm()
            setEditingId(null)
            setShowForm(false)
            setNewCustomerMode(false)
          }}
          onOverrideApproved={handleOverrideApproved}
        />

        {showForm && (
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 rounded-lg mb-6 border border-theme-border/30">
            <h3 className="text-lg sm:text-xl font-semibold text-dr7-gold mb-4">
              {editingId ? 'Modifica Prenotazione' : 'Nuova Prenotazione'}
            </h3>

            {/* Active override badges */}
            {activeOverrides.length > 0 && (
              <div className="mb-4 space-y-1">
                {activeOverrides.map((o) => (
                  <div key={o.overrideId} className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs">
                    <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="text-amber-300">Limitazione bypassata con autorizzazione OTP:</span>
                    <span className="text-theme-text-muted font-mono">{o.limitationCode}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Booking Type Selection - Mobile Optimized */}
            {/* Customer Selection - Mobile Optimized */}
            <div className="mb-4 sm:mb-6 p-3 sm:p-4  rounded-lg border border-theme-border">
              <div className="border-b border-theme-border pb-4">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <button
                    type="button"
                    onClick={() => setNewCustomerMode(false)}
                    className={`px-4 py-2 min-h-[44px] rounded-full ${!newCustomerMode ? 'bg-dr7-gold text-white font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                  >
                    Seleziona Cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewCustomerMode(true)}
                    className={`px-4 py-2 min-h-[44px] rounded-full ${newCustomerMode ? 'bg-dr7-gold text-white font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
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
                      onChange={(e) => setNewCustomerData({ ...newCustomerData, tipo_cliente: e.target.value as typeof newCustomerData.tipo_cliente })}
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
                          <div className="flex gap-2 items-end">
                            <div className="flex-1">
                              <Input label="Codice Fiscale *" required value={newCustomerData.codice_fiscale} onChange={(e) => {
                                const val = e.target.value.toUpperCase()
                                // Auto-decode when 16 chars entered
                                if (val.length === 16) {
                                  const decoded = decodificaCodiceFiscale(val)
                                  if (decoded) {
                                    setNewCustomerData(prev => ({
                                      ...prev,
                                      codice_fiscale: val,
                                      data_nascita: decoded.data_nascita,
                                      sesso: decoded.sesso,
                                      luogo_nascita: decoded.luogo_nascita,
                                    }))
                                    toast.success('Dati estratti dal CF')
                                    return
                                  }
                                }
                                setNewCustomerData(prev => ({ ...prev, codice_fiscale: val }))
                              }} />
                            </div>
                            <CalcolaCFButton
                              className="px-3 py-2 mb-[1px] bg-dr7-gold hover:bg-dr7-gold/80 text-white text-xs font-medium rounded whitespace-nowrap transition-colors"
                              config={{
                                getCognome: () => newCustomerData.cognome,
                                getNome: () => newCustomerData.nome,
                                getDataNascita: () => newCustomerData.data_nascita,
                                getSesso: () => newCustomerData.sesso,
                                getLuogoNascita: () => newCustomerData.luogo_nascita,
                                getCodiceFiscale: () => newCustomerData.codice_fiscale,
                                setCodiceFiscale: (v) => setNewCustomerData(p => ({ ...p, codice_fiscale: v })),
                                setSesso: (v) => setNewCustomerData(p => ({ ...p, sesso: v as '' | 'M' | 'F' })),
                                setDataNascita: (v) => setNewCustomerData(p => ({ ...p, data_nascita: v })),
                                setLuogoNascita: (v) => setNewCustomerData(p => ({ ...p, luogo_nascita: v })),
                                setProvinciaNascita: (v) => setNewCustomerData(p => ({ ...p, provincia_nascita: v })),
                              }}
                            />
                          </div>
                          <Input label="Data di Nascita *" type="date" value={newCustomerData.data_nascita} onChange={(e) => setNewCustomerData({ ...newCustomerData, data_nascita: e.target.value })} />
                          <Input label="Luogo di Nascita *" value={newCustomerData.luogo_nascita} onChange={(e) => setNewCustomerData({ ...newCustomerData, luogo_nascita: e.target.value })} />
                          <Select label="Sesso *" value={newCustomerData.sesso} onChange={(e) => setNewCustomerData({ ...newCustomerData, sesso: e.target.value as '' | 'M' | 'F' })} options={[{ value: '', label: 'Seleziona...' }, { value: 'M', label: 'Maschio' }, { value: 'F', label: 'Femmina' }]} />
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
                      onSelectCustomer={async (customerId) => {
                        setFormData(prev => ({ ...prev, customer_id: customerId }))
                        setCustomerTier(null) // Reset tier while loading
                        if (!customerId) return

                        // Incrementa l'ID di richiesta: qualunque fetch in volo dal
                        // customer precedente scarterà la sua risposta se trova un ID
                        // diverso. Previene la race: A selezionato → fetch lento → B
                        // selezionato → fetch B veloce → fetch A torna e sovrascrive.
                        customerTierRequestRef.current += 1
                        const requestId = customerTierRequestRef.current

                        // Primo tentativo: dati dal customers array locale (stessa
                        // fonte di PreventiviTab). Se i campi sono già lì, classifica
                        // subito senza HTTP. Niente più customerTier undefined quando
                        // il cliente è in list-customers.
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const localCust = customers.find((c: any) => c.id === customerId) as any
                        const localBirth = localCust?.data_nascita
                        const localPatente = localCust?.data_rilascio_patente
                        if (localBirth && localPatente) {
                          try {
                            const age = calculateAge(localBirth)
                            const licYears = calculateLicenseYears(localPatente)
                            const tier = classifyDriverTier(age, licYears)
                            if (customerTierRequestRef.current === requestId) setCustomerTier(tier)
                          } catch (e) { console.warn('[ReservationsTab] local tier classify failed:', e) }
                        }

                        try {
                          const resp = await authFetch(`/.netlify/functions/get-customer?id=${customerId}`)
                          if (customerTierRequestRef.current !== requestId) return // stale
                          if (!resp.ok) return
                          const { customer: cust } = await resp.json()
                          if (customerTierRequestRef.current !== requestId) return // stale dopo parse
                          const birthDate = cust?.data_nascita
                          const patenteDate = cust?.data_rilascio_patente || cust?.metadata?.patente?.rilascio

                          // Classify driver tier
                          if (birthDate && patenteDate) {
                            const age = calculateAge(birthDate)
                            const licYears = calculateLicenseYears(patenteDate)
                            const tier = classifyDriverTier(age, licYears)
                            setCustomerTier(tier)

                            // IMMEDIATE checks — OTP required before proceeding
                            if (tier.tier === 'BLOCKED' && !hasOverride('driver_blocked')) {
                              requestOverride('driver_blocked', `Cliente non idoneo al noleggio: ${tier.reason} (Età: ${age} anni — Patente: ${licYears} anni)`)
                            }
                            if (licYears < 3 && !hasOverride('license_too_recent')) {
                              requestOverride('license_too_recent', `Patente rilasciata da meno di 3 anni (${licYears} anni). Il cliente non può noleggiare.`)
                            }

                            // Check expired license immediately
                            const scadenzaP = cust?.scadenza_patente || cust?.data_scadenza_patente || cust?.metadata?.patente?.scadenza
                            if (scadenzaP) {
                              const expDate = new Date(scadenzaP)
                              if (expDate < new Date() && !hasOverride('license_expired')) {
                                requestOverride('license_expired', `Patente scaduta il ${expDate.toLocaleDateString('it-IT')}. Il cliente non può noleggiare con patente scaduta.`)
                              }
                            }

                            // Reset incompatible options when tier changes
                            setFormData(prev => {
                              const updates: Record<string, unknown> = {}
                              // If TIER_1, block no_cauzione
                              if (tier.tier === 'TIER_1' && prev.deposit_status === 'no_cauzione') {
                                updates.deposit_status = 'da_incassare'
                              }
                              // Check if current insurance option is valid for this tier
                              const selectedVehicle = vehicles.find(v => v.id === prev.vehicle_id)
                              const tierOptions = getInsuranceOptions(selectedVehicle, tier.tier, configOverlay, rentalConfig)
                              if (!tierOptions.some(o => o.id === prev.insurance_option)) {
                                updates.insurance_option = 'KASKO_BASE'
                              }
                              return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev
                            })
                          } else if (patenteDate) {
                            // Only license date available — still check minimum
                            const licYears = calculateLicenseYears(patenteDate)
                            if (licYears < 3 && !hasOverride('license_too_recent')) {
                              requestOverride('license_too_recent', `Patente rilasciata da meno di 3 anni (${licYears} anni). Il cliente non può noleggiare.`)
                            }
                          }
                        } catch (e) {
                          logger.warn('Customer tier check failed:', e)
                        }
                      }}
                      placeholder="Inizia a scrivere nome, email o telefono..."
                      required={true}
                    />

                    {/* Show selected customer details */}
                    {formData.customer_id && (() => {
                      const selectedCustomer = customers.find(c => c.id === formData.customer_id)
                      if (selectedCustomer) {
                        return (
                          <div className={`mt-3 p-3 rounded-lg ${selectedCustomer.scadenza_patente && new Date(selectedCustomer.scadenza_patente) < new Date() ? 'bg-red-900/40 border border-red-500/70' : 'bg-green-900/30 border border-green-600/50'}`}>
                            <p className={`font-medium mb-1 ${selectedCustomer.scadenza_patente && new Date(selectedCustomer.scadenza_patente) < new Date() ? 'text-red-400' : 'text-green-400'}`}>Cliente selezionato:</p>
                            <p className="text-theme-text-primary font-bold">{selectedCustomer.full_name}</p>
                            {selectedCustomer.email && <p className="text-theme-text-secondary text-sm">{selectedCustomer.email}</p>}
                            {selectedCustomer.phone && <p className="text-theme-text-secondary text-sm">{selectedCustomer.phone}</p>}
                            {selectedCustomer.scadenza_patente && new Date(selectedCustomer.scadenza_patente) < new Date() && (
                              <div className="mt-2 px-3 py-2 bg-red-500/20 border border-red-500/40 rounded-lg flex items-center gap-2">
                                <span className="text-red-400 text-lg">&#9888;</span>
                                <div>
                                  <p className="text-red-400 font-bold text-sm">PATENTE SCADUTA</p>
                                  <p className="text-red-300 text-xs">Scaduta il {new Date(selectedCustomer.scadenza_patente).toLocaleDateString('it-IT')}</p>
                                </div>
                              </div>
                            )}
                            {selectedCustomer.scadenza_patente && (() => {
                              const exp = new Date(selectedCustomer.scadenza_patente)
                              const now = new Date()
                              const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                              if (diffDays > 0 && diffDays <= 30) {
                                return (
                                  <div className="mt-2 px-3 py-2 bg-amber-500/20 border border-amber-500/40 rounded-lg flex items-center gap-2">
                                    <span className="text-amber-400 text-lg">&#9888;</span>
                                    <p className="text-amber-400 font-medium text-sm">Patente scade tra {diffDays} giorni ({new Date(selectedCustomer.scadenza_patente).toLocaleDateString('it-IT')})</p>
                                  </div>
                                )
                              }
                              return null
                            })()}
                          </div>
                        )
                      }
                      return null
                    })()}

                    {/* Tier Badge */}
                    {customerTier && customerTier.tier !== 'BLOCKED' && (
                      <div className={`mt-2 px-3 py-2 rounded-lg flex items-center gap-2 ${
                        customerTier.tier === 'TIER_2'
                          ? 'bg-green-900/20 border border-green-600/50'
                          : 'bg-amber-900/20 border border-amber-600/50'
                      }`}>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          customerTier.tier === 'TIER_2' ? 'bg-green-600 text-white' : 'bg-amber-600 text-white'
                        }`}>
                          {customerTier.tier === 'TIER_2' ? 'FASCIA A' : 'FASCIA B'}
                        </span>
                        <span className="text-sm text-theme-text-secondary">
                          {customerTier.reason} — Età: {customerTier.driverAge}, Patente: {customerTier.licenseYears} anni
                        </span>
                      </div>
                    )}

                    {/* Manual Fascia Selector — come PreventiviTab. Forza la fascia
                        usata per pricing (km illimitati, secondo guidatore, DR7 Flex,
                        insurance). Override su customerTier auto-classificato. */}
                    <div className="mt-3">
                      <label className="block text-sm font-medium text-theme-text-secondary mb-2">Fascia Cliente</label>
                      <select
                        value={customerTier?.tier === 'TIER_1' || customerTier?.tier === 'TIER_2' ? customerTier.tier : ''}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === 'TIER_1' || v === 'TIER_2') {
                            setCustomerTier({
                              tier: v,
                              reason: 'Fascia impostata manualmente',
                              driverAge: customerTier?.driverAge || 0,
                              licenseYears: customerTier?.licenseYears || 0,
                            })
                            // Reset insurance option (come PreventiviTab line 2034)
                            setFormData(prev => ({ ...prev, insurance_option: 'KASKO_BASE' as KaskoTier }))
                          }
                        }}
                        className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
                      >
                        <option value="">-- Seleziona Fascia --</option>
                        <option value="TIER_2">Fascia A (26-69, patente 5+ anni)</option>
                        <option value="TIER_1">Fascia B (21-25 o patente 3-4 anni)</option>
                      </select>
                    </div>

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
                    min={editingId ? undefined : new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })}
                    value={formData.pickup_date}
                    onChange={(e) => {
                      const v = e.target.value
                      setFormData(prev => {
                        // Default Data Riconsegna to pickup + 1 day when it is
                        // empty or no longer ≥ pickup. Leave it alone if the
                        // admin already chose a later date.
                        let nextReturn = prev.return_date
                        if (v) {
                          const needsAuto = !prev.return_date || prev.return_date <= v
                          if (needsAuto) {
                            const d = new Date(`${v}T00:00:00`)
                            d.setDate(d.getDate() + 1)
                            nextReturn = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
                          }
                        }
                        return { ...prev, pickup_date: v, return_date: nextReturn }
                      })
                    }}
                  />
                  <Select
                    label="Ora Ritiro"
                    required
                    value={formData.pickup_time}
                    onChange={(e) => {
                      const pickupTime = e.target.value
                      const returnTime = calculateReturnTime(pickupTime)
                      setFormData(prev => ({ ...prev, pickup_time: pickupTime, return_time: returnTime }))
                      if (!isInRentalHours(formData.pickup_date, pickupTime, 'pickup') && !hasOverride('out_of_office_hours')) {
                        const r = rentalHoursFor(formData.pickup_date, 'pickup')
                        const fmt = (m: number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
                        const hoursLabel = r ? r.map(([a,b]) => `${fmt(a)}-${fmt(b)}`).join(' / ') : 'Domenica chiusa'
                        requestOverride('out_of_office_hours', `Ritiro alle ${pickupTime} fuori orario standard (orari: ${hoursLabel}).`)
                      }
                    }}
                    options={buildRentalTimeOptions(formData.pickup_date, 'pickup')}
                  />
                  {!isInRentalHours(formData.pickup_date, formData.pickup_time, 'pickup') && formData.pickup_time && formData.pickup_date && (
                    <p className="text-xs text-red-400 mt-1 font-semibold">
                      ⚠️ FUORI ORARIO — il ritiro alle {formData.pickup_time} non è in orario di apertura
                      {(() => {
                        const r = rentalHoursFor(formData.pickup_date, 'pickup')
                        if (!r) return ' (Domenica chiuso)'
                        const fmt = (m: number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
                        return ` (orari: ${r.map(([a,b]) => `${fmt(a)}-${fmt(b)}`).join(' / ')})`
                      })()}
                    </p>
                  )}
                  <p className="text-xs text-green-400 mt-1">Admin: Qualsiasi orario disponibile · 🔴 = fuori orario standard</p>
                </div>
                <Select
                  label="Luogo Ritiro"
                  required
                  value={formData.pickup_location}
                  onChange={(e) => {
                    const loc = e.target.value
                    setFormData(prev => ({
                      ...prev,
                      pickup_location: loc,
                      delivery_enabled: loc === 'domicilio' || loc === 'cagliari_airport',
                      delivery_fee: loc === 'cagliari_airport' ? '50' : loc === 'domicilio' ? prev.delivery_fee : '0',
                      ...(loc === 'cagliari_airport' ? {
                        delivery_street: 'Aeroporto di Cagliari Elmas',
                        delivery_city: 'Elmas', delivery_zip: '09030', delivery_province: 'CA',
                      } : loc === 'dr7_office' ? {
                        delivery_enabled: false, delivery_fee: '0',
                        delivery_street: '', delivery_city: '', delivery_zip: '', delivery_province: '',
                      } : {}),
                    }))
                  }}
                  options={LOCATIONS}
                />
                {formData.pickup_location === 'domicilio' && (
                  <div className="mt-2 space-y-2 p-3 bg-theme-bg-tertiary rounded border border-theme-border">
                    <p className="text-xs text-amber-400 font-semibold">Indirizzo di consegna</p>
                    <AddressAutocomplete
                      label="Indirizzo Consegna *"
                      required
                      value={formData.delivery_street}
                      onChange={(val) => setFormData(prev => ({ ...prev, delivery_street: val }))}
                      onSelectParts={(parts) => setFormData(prev => ({
                        ...prev,
                        delivery_street: parts.street || parts.full,
                        delivery_city: parts.city,
                        delivery_zip: parts.zip,
                        delivery_province: parts.province,
                      }))}
                      placeholder="Via Roma 15, 09131 Cagliari"
                    />
                    <div className="grid grid-cols-3 gap-2 mt-1">
                      <Input label="Città" value={formData.delivery_city}
                        onChange={(e) => setFormData({ ...formData, delivery_city: e.target.value })} placeholder="Cagliari" />
                      <Input label="CAP" value={formData.delivery_zip}
                        onChange={(e) => setFormData({ ...formData, delivery_zip: e.target.value })} placeholder="09131" maxLength={5} />
                      <Input label="Provincia" value={formData.delivery_province}
                        onChange={(e) => setFormData({ ...formData, delivery_province: e.target.value.toUpperCase() })} placeholder="CA" maxLength={2} />
                    </div>
                    <Input label="Costo consegna (€) *" type="number" step="0.01" min="0" required
                      value={formData.delivery_fee}
                      onChange={(e) => setFormData({ ...formData, delivery_fee: e.target.value })} placeholder="0.00" />
                  </div>
                )}
                <div className="space-y-3">
                  <Input
                    label="Data Riconsegna"
                    type="date"
                    required
                    min={formData.pickup_date}
                    value={formData.return_date}
                    onChange={(e) => { const v = e.target.value; setFormData(prev => ({ ...prev, return_date: v })) }}
                  />
                  <Select
                    label="Ora Riconsegna"
                    required
                    value={formData.return_time}
                    onChange={(e) => {
                      const v = e.target.value
                      setFormData(prev => ({ ...prev, return_time: v }))
                      if (!isInRentalHours(formData.return_date, v, 'return') && !hasOverride('out_of_office_hours')) {
                        const r = rentalHoursFor(formData.return_date, 'return')
                        const fmt = (m: number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
                        const hoursLabel = r ? r.map(([a,b]) => `${fmt(a)}-${fmt(b)}`).join(' / ') : 'Domenica chiusa'
                        requestOverride('out_of_office_hours', `Riconsegna alle ${v} fuori orario standard (orari: ${hoursLabel}).`)
                      }
                    }}
                    options={buildRentalTimeOptions(formData.return_date, 'return')}
                  />
                  {!isInRentalHours(formData.return_date, formData.return_time, 'return') && formData.return_time && formData.return_date && (
                    <p className="text-xs text-red-400 mt-1 font-semibold">
                      ⚠️ FUORI ORARIO — la riconsegna alle {formData.return_time} non è in orario di apertura
                      {(() => {
                        const r = rentalHoursFor(formData.return_date, 'return')
                        if (!r) return ' (Domenica chiuso)'
                        const fmt = (m: number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
                        return ` (orari: ${r.map(([a,b]) => `${fmt(a)}-${fmt(b)}`).join(' / ')})`
                      })()}
                    </p>
                  )}
                  <p className="text-xs text-blue-400 mt-1">Suggerito: Ritiro - 1h30</p>
                  <p className="text-xs text-green-400">Admin: Qualsiasi orario disponibile · 🔴 = fuori orario standard</p>
                </div>
                <Select
                  label="Luogo Riconsegna"
                  required
                  value={formData.dropoff_location}
                  onChange={(e) => {
                    const loc = e.target.value
                    setFormData(prev => ({
                      ...prev,
                      dropoff_location: loc,
                      pickup_enabled: loc === 'domicilio' || loc === 'cagliari_airport',
                      pickup_fee: loc === 'cagliari_airport' ? '50' : loc === 'domicilio' ? prev.pickup_fee : '0',
                      ...(loc === 'cagliari_airport' ? {
                        pickup_street: 'Aeroporto di Cagliari Elmas',
                        pickup_city: 'Elmas', pickup_zip: '09030', pickup_province: 'CA',
                      } : loc === 'dr7_office' ? {
                        pickup_enabled: false, pickup_fee: '0',
                        pickup_street: '', pickup_city: '', pickup_zip: '', pickup_province: '',
                      } : {}),
                    }))
                  }}
                  options={LOCATIONS}
                />
                {formData.dropoff_location === 'domicilio' && (
                  <div className="mt-2 space-y-2 p-3 bg-theme-bg-tertiary rounded border border-theme-border">
                    <p className="text-xs text-amber-400 font-semibold">Indirizzo di ritiro veicolo</p>
                    <AddressAutocomplete
                      label="Indirizzo Ritiro *"
                      required
                      value={formData.pickup_street}
                      onChange={(val) => setFormData(prev => ({ ...prev, pickup_street: val }))}
                      onSelectParts={(parts) => setFormData(prev => ({
                        ...prev,
                        pickup_street: parts.street || parts.full,
                        pickup_city: parts.city,
                        pickup_zip: parts.zip,
                        pickup_province: parts.province,
                      }))}
                      placeholder="Via Roma 15, 09131 Cagliari"
                    />
                    <div className="grid grid-cols-3 gap-2 mt-1">
                      <Input label="Città" value={formData.pickup_city}
                        onChange={(e) => setFormData({ ...formData, pickup_city: e.target.value })} placeholder="Cagliari" />
                      <Input label="CAP" value={formData.pickup_zip}
                        onChange={(e) => setFormData({ ...formData, pickup_zip: e.target.value })} placeholder="09131" maxLength={5} />
                      <Input label="Provincia" value={formData.pickup_province}
                        onChange={(e) => setFormData({ ...formData, pickup_province: e.target.value.toUpperCase() })} placeholder="CA" maxLength={2} />
                    </div>
                    <Input label="Costo ritiro (€) *" type="number" step="0.01" min="0" required
                      value={formData.pickup_fee}
                      onChange={(e) => setFormData({ ...formData, pickup_fee: e.target.value })} placeholder="0.00" />
                  </div>
                )}
              </div>

              {/* VEHICLE SELECTION - Now appears after dates */}
              <div className="md:col-span-2">
                {!formData.pickup_date || !formData.return_date ? (
                  <div className="p-4 bg-yellow-900/20 border border-yellow-600/50 rounded-lg">
                    <p className="text-yellow-400 text-sm">
                      Seleziona le date per vedere i veicoli disponibili
                    </p>
                  </div>
                ) : (
                  <>
                    <Select
                      label={`Veicolo (${vehiclesForDropdown.length} ${showAllVehicles ? 'totali' : 'disponibili'})`}
                      required
                      value={formData.vehicle_id}
                      onChange={(e) => { const v = e.target.value; setFormData(prev => ({ ...prev, vehicle_id: v })) }}
                      options={[
                        { value: '', label: 'Seleziona veicolo...' },
                        ...vehiclesForDropdown.map((v: Vehicle) => {
                          let label = v.plate || v.targa ? `${v.display_name} (Targa: ${v.plate || v.targa})` : v.display_name
                          const earliestTime = vehicleEarliestTimes.get(v.id)
                          if (earliestTime && !showAllVehicles) {
                            const hours = earliestTime.getHours().toString().padStart(2, '0')
                            const minutes = earliestTime.getMinutes().toString().padStart(2, '0')
                            label += ` (disponibile dalle ${hours}:${minutes})`
                          }
                          return { value: v.id, label }
                        })
                      ]}
                    />
                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showAllVehicles}
                        onChange={(e) => setShowAllVehicles(e.target.checked)}
                        className="w-4 h-4 rounded border-theme-border bg-theme-bg-tertiary text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-sm text-amber-400">Mostra tutti i veicoli (ignora disponibilità)</span>
                    </label>
                  </>
                )}
                {formData.pickup_date && formData.return_date && vehiclesForDropdown.length === 0 && !showAllVehicles && (
                  <p className="text-red-400 text-sm mt-2">
                    Nessun veicolo disponibile per le date selezionate. Usa la checkbox sopra per mostrare tutti.
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
                  onChange={(e) => setFormData(prev => ({ ...prev, has_second_driver: e.target.checked }))}
                  className="w-4 h-4 text-dr7-gold bg-theme-bg-tertiary border-theme-border-light rounded focus:ring-dr7-gold focus:ring-offset-gray-800"
                />
                <label htmlFor="has_second_driver" className="ml-2 text-sm font-medium text-theme-text-secondary">
                  Aggiungi Secondo Guidatore
                  {(() => {
                    const tier = customerTier?.tier
                    const price = tier === 'TIER_2' ? CFG_SECOND_DRIVER.TIER_2 : CFG_SECOND_DRIVER.TIER_1
                    return ` (+€${price}/giorno)`
                  })()}
                </label>
              </div>

              {formData.has_second_driver && (
                <div className="space-y-4 animate-fadeIn">
                  {/* Toggle between Select Customer and New Driver */}
                  <div className="flex items-center gap-4 mb-4">
                    <button
                      type="button"
                      onClick={() => setNewSecondDriverMode(false)}
                      className={`px-4 py-2 rounded-full ${!newSecondDriverMode ? 'bg-dr7-gold text-white font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                    >
                      Seleziona Cliente
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewSecondDriverMode(true)}
                      className={`px-4 py-2 rounded-full ${newSecondDriverMode ? 'bg-dr7-gold text-white font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
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
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_name: e.target.value }))}
                      />
                      <Input
                        label="Cognome *"
                        required
                        value={formData.second_driver_surname}
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_surname: e.target.value }))}
                      />
                      <div>
                        <label className="block text-sm font-medium text-theme-text-primary mb-2">Codice Fiscale *</label>
                        <div className="flex gap-2">
                          <input
                            required
                            value={formData.second_driver_codice_fiscale}
                            onChange={(e) => setFormData(prev => ({ ...prev, second_driver_codice_fiscale: e.target.value.toUpperCase() }))}
                            className="flex-1 px-3 py-2 min-h-[44px] bg-theme-bg-primary border border-dr7-gold/30 rounded text-base sm:text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors uppercase"
                          />
                          <CalcolaCFButton
                            className="px-3 py-2 bg-dr7-gold hover:bg-dr7-gold/80 text-white text-xs font-medium rounded whitespace-nowrap transition-colors"
                            config={{
                              getCognome: () => formData.second_driver_surname,
                              getNome: () => formData.second_driver_name,
                              getDataNascita: () => formData.second_driver_birth_date,
                              getSesso: () => formData.second_driver_sesso,
                              getLuogoNascita: () => formData.second_driver_birth_place,
                              getCodiceFiscale: () => formData.second_driver_codice_fiscale,
                              setCodiceFiscale: (v) => setFormData(p => ({ ...p, second_driver_codice_fiscale: v })),
                              setSesso: (v) => setFormData(p => ({ ...p, second_driver_sesso: v })),
                              setDataNascita: (v) => setFormData(p => ({ ...p, second_driver_birth_date: v })),
                              setLuogoNascita: (v) => setFormData(p => ({ ...p, second_driver_birth_place: v })),
                              setProvinciaNascita: (v) => setFormData(p => ({ ...p, second_driver_birth_provincia: v })),
                            }}
                          />
                        </div>
                      </div>
                      <Select
                        label="Sesso *"
                        required
                        value={formData.second_driver_sesso}
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_sesso: e.target.value }))}
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
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_indirizzo: e.target.value }))}
                      />
                      <Input
                        label="CAP *"
                        required
                        value={formData.second_driver_cap}
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_cap: e.target.value }))}
                      />
                      <Input
                        label="Città *"
                        required
                        value={formData.second_driver_citta}
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_citta: e.target.value }))}
                      />
                      <Input
                        label="Provincia *"
                        required
                        value={formData.second_driver_provincia}
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_provincia: e.target.value.toUpperCase() }))}
                        maxLength={2}
                      />
                      <Input
                        label="Data di Nascita *"
                        type="date"
                        required
                        value={formData.second_driver_birth_date}
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_birth_date: e.target.value }))}
                      />
                      <Input
                        label="Città di Nascita *"
                        required
                        value={formData.second_driver_birth_place}
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_birth_place: e.target.value }))}
                      />
                      <Input
                        label="Provincia di Nascita *"
                        required
                        value={formData.second_driver_birth_provincia}
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_birth_provincia: e.target.value.toUpperCase() }))}
                        maxLength={2}
                      />
                      <Input
                        label="Telefono *"
                        type="tel"
                        required
                        value={formData.second_driver_phone}
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_phone: e.target.value }))}
                      />
                      <Input
                        label="E-mail *"
                        type="email"
                        required
                        value={formData.second_driver_email}
                        onChange={(e) => setFormData(prev => ({ ...prev, second_driver_email: e.target.value }))}
                      />

                      {/* License Details */}
                      <div className="md:col-span-2 border-t border-theme-border-light pt-4 mt-2">
                        <h4 className="text-theme-text-primary font-semibold mb-3">Dettagli Patente</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <Input
                            label="Tipo di Patente *"
                            required
                            value={formData.second_driver_license_type}
                            onChange={(e) => setFormData(prev => ({ ...prev, second_driver_license_type: e.target.value }))}
                            placeholder="es. B"
                          />
                          <Input
                            label="Numero Patente *"
                            required
                            value={formData.second_driver_license_number}
                            onChange={(e) => setFormData(prev => ({ ...prev, second_driver_license_number: e.target.value }))}
                          />
                          <Input
                            label="Emessa da *"
                            required
                            value={formData.second_driver_license_issued_by}
                            onChange={(e) => setFormData(prev => ({ ...prev, second_driver_license_issued_by: e.target.value }))}
                            placeholder="es. Motorizzazione Civile"
                          />
                          <Input
                            label="Data di Rilascio *"
                            type="date"
                            required
                            value={formData.second_driver_license_issue_date}
                            onChange={(e) => setFormData(prev => ({ ...prev, second_driver_license_issue_date: e.target.value }))}
                          />
                          <Input
                            label="Scadenza Patente *"
                            type="date"
                            required
                            value={formData.second_driver_license_expiry}
                            onChange={(e) => setFormData(prev => ({ ...prev, second_driver_license_expiry: e.target.value }))}
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
                        onSelectCustomer={(customerId) => setFormData(prev => ({ ...prev, second_driver_id: customerId }))}
                        placeholder="Inizia a scrivere nome, email o telefono..."
                        required={false}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Kasko & Deposit */}
            <div className="md:col-span-2  p-4 rounded-lg border border-theme-border">
              <h4 className="text-theme-text-primary font-semibold mb-3">Opzioni Noleggio & Cauzione</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Assicurazione</label>
                  <select
                    value={formData.insurance_option}
                    onChange={(e) => {
                      const newOption = e.target.value as KaskoTier;
                      setFormData(prev => ({
                        ...prev,
                        insurance_option: newOption,
                        // Auto-reset no_cauzione when switching to RCA (requires Kasko)
                        ...(newOption === 'RCA' && prev.deposit_status === 'no_cauzione' ? { deposit_status: 'da_incassare' as const } : {}),
                      }));
                    }}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                  >
                    {(() => {
                      const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id);
                      const activeTier = customerTier?.tier;
                      return getInsuranceOptions(selectedVehicle, activeTier, configOverlay, rentalConfig).map(opt => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label} {opt.pricePerDay > 0 ? `(€${opt.pricePerDay}/giorno)` : '(inclusa)'}
                        </option>
                      ));
                    })()}
                  </select>
                  {formData.insurance_option === 'RCA' && (
                    <p className="text-xs text-yellow-400 mt-1">
                      ⚠️ Senza Kasko: cauzione obbligatoria €{customerTier?.tier === 'TIER_2' ? '10.000' : '15.000'}
                    </p>
                  )}
                </div>
                {!formData.cauzione_auto && (
                  <>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                        Opzione Cauzione · {customerTier?.tier === 'TIER_1' ? 'Fascia B' : 'Fascia A'} · {isResidenteSardegna ? 'Residente' : 'Non residente'}
                      </label>
                      {depositOptionsForCurrentBooking.length === 0 ? (
                        <p className="text-xs text-amber-400 mb-2">
                          Nessuna opzione configurata in Centralina Pro per questa combinazione.
                          Configurale in Centralina Pro → Cauzioni o inserisci manualmente l'importo.
                        </p>
                      ) : (
                        <select
                          value={formData.deposit_option_id}
                          onChange={(e) => {
                            const optId = e.target.value
                            const opt = depositOptionsForCurrentBooking.find(o => o.id === optId)
                            const amount = Number(opt?.amount)
                            const isNoDep = opt ? isNoDepositOpt(opt) : false
                            setFormData(prev => ({
                              ...prev,
                              deposit_option_id: optId,
                              deposit: optId
                                ? (Number.isFinite(amount) ? String(amount) : '0')
                                : prev.deposit,
                              // Sync legacy deposit_status to keep downstream
                              // logic (ConfirmationSuccess, contract gen) working.
                              deposit_status: isNoDep ? 'no_cauzione' : (prev.deposit_status === 'no_cauzione' ? 'da_incassare' : prev.deposit_status),
                            }))
                          }}
                          className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                        >
                          <option value="">— Seleziona opzione —</option>
                          {depositOptionsForCurrentBooking.map((o, i) => {
                            const amt = Number(o.amount) || 0
                            const surcharge = Number(o.surcharge_per_day) || 0
                            const parts: string[] = []
                            if (amt > 0) parts.push(`€${amt.toLocaleString('it-IT')}`)
                            if (surcharge > 0) parts.push(`+ €${surcharge}/giorno`)
                            return (
                              <option key={(o.id || '') + ':' + i} value={o.id || ''}>
                                {o.label || o.id} {parts.length > 0 ? `(${parts.join(' ')})` : ''}
                              </option>
                            )
                          })}
                        </select>
                      )}
                      {selectedDepositOption && (
                        <p className="text-xs text-blue-400 mt-1">
                          Importo: €{Number(selectedDepositOption.amount || 0).toLocaleString('it-IT')}
                          {selectedDepositSurchargePerDay > 0 && ` · Supplemento €${selectedDepositSurchargePerDay}/giorno aggiunto al totale`}
                        </p>
                      )}
                    </div>
                    <Input
                      label="Cauzione (€)"
                      type="number"
                      value={formData.deposit}
                      onChange={(e) => { const v = e.target.value; setFormData(prev => ({ ...prev, deposit: v, deposit_option_id: '' })) }}
                    />
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">Stato Cauzione</label>
                      <select
                        value={formData.deposit_status}
                        onChange={(e) => {
                          const val = e.target.value as 'da_incassare' | 'incassata' | 'no_cauzione';
                          setFormData(prev => ({
                            ...prev,
                            deposit_status: val,
                            ...(val === 'no_cauzione' ? { deposit: '0' } : {}),
                          }));
                        }}
                        className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                      >
                        <option value="da_incassare">Da incassare</option>
                        <option value="incassata">Incassata</option>
                        {(!customerTier || customerTier.tier === 'TIER_2') && formData.insurance_option !== 'RCA' && (
                          <option value="no_cauzione">No Cauzione (+€{CFG_NO_CAUZIONE_PER_DAY}/giorno)</option>
                        )}
                      </select>
                      {formData.deposit_status === 'no_cauzione' && !selectedDepositOption && (
                        <p className="text-xs text-blue-400 mt-1">Supplemento €{CFG_NO_CAUZIONE_PER_DAY}/giorno aggiunto al totale</p>
                      )}
                      {customerTier?.tier === 'TIER_1' && (
                        <p className="text-xs text-amber-400 mt-1">No Cauzione non disponibile per Fascia B</p>
                      )}
                      {customerTier?.tier === 'TIER_2' && formData.insurance_option === 'RCA' && (
                        <p className="text-xs text-amber-400 mt-1">No Cauzione richiede una Kasko attiva</p>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Cauzione Auto Toggle */}
              <div className="mt-4">
                <div className="flex items-center mb-3">
                  <input
                    type="checkbox"
                    id="cauzione_auto"
                    checked={formData.cauzione_auto}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setFormData(prev => ({
                        ...prev,
                        cauzione_auto: checked,
                        ...(!checked && {
                          cauzione_targa: '', cauzione_targa_year: '', cauzione_targa_brand: '', cauzione_targa_model: '',
                          cauzione_proprietario_tipo: 'guidatore' as const,
                          garante_customer_id: '', garante_nome: '', garante_cognome: '', garante_codice_fiscale: '',
                          garante_sesso: '', garante_indirizzo: '', garante_cap: '', garante_citta: '', garante_provincia: '',
                          garante_birth_date: '', garante_birth_place: '', garante_birth_provincia: '', garante_phone: '', garante_email: '',
                        })
                      }))
                    }}
                    className="w-4 h-4 text-dr7-gold bg-theme-bg-tertiary border-theme-border-light rounded focus:ring-dr7-gold focus:ring-offset-gray-800"
                  />
                  <label htmlFor="cauzione_auto" className="ml-2 text-sm font-medium text-theme-text-secondary">
                    Auto come Cauzione
                  </label>
                </div>

                {formData.cauzione_auto && (
                  <div className="space-y-4 animate-fadeIn">
                    {/* Targa Lookup */}
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Input
                          label="Targa Veicolo Cauzione *"
                          value={formData.cauzione_targa}
                          onChange={(e) => setFormData(prev => ({ ...prev, cauzione_targa: e.target.value.toUpperCase() }))}
                          placeholder="es. AB123CD"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleLookupCauzioneTarga}
                        disabled={targaLoading}
                        className="px-4 py-2 bg-dr7-gold text-white rounded-lg hover:bg-dr7-gold/80 disabled:opacity-50 mb-[2px]"
                      >
                        {targaLoading ? 'Cerca...' : 'Cerca'}
                      </button>
                    </div>

                    {/* Vehicle Info Display */}
                    {formData.cauzione_targa_brand && (
                      <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg text-sm text-theme-text-primary">
                        <strong>{formData.cauzione_targa_brand} {formData.cauzione_targa_model}</strong> — Anno: {formData.cauzione_targa_year}
                      </div>
                    )}

                    {/* Proprietario Tipo */}
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-2">Proprietario del veicolo</label>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="cauzione_proprietario_tipo"
                            value="guidatore"
                            checked={formData.cauzione_proprietario_tipo === 'guidatore'}
                            onChange={() => setFormData(prev => ({ ...prev, cauzione_proprietario_tipo: 'guidatore' }))}
                            className="text-dr7-gold focus:ring-dr7-gold"
                          />
                          <span className="text-sm text-theme-text-primary">Proprietario = 1° Guidatore</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="cauzione_proprietario_tipo"
                            value="diverso"
                            checked={formData.cauzione_proprietario_tipo === 'diverso'}
                            onChange={() => setFormData(prev => ({ ...prev, cauzione_proprietario_tipo: 'diverso' }))}
                            className="text-dr7-gold focus:ring-dr7-gold"
                          />
                          <span className="text-sm text-theme-text-primary">Proprietario Diverso</span>
                        </label>
                      </div>
                    </div>

                    {/* Garante Form (only when diverso) */}
                    {formData.cauzione_proprietario_tipo === 'diverso' && (
                      <div className="space-y-4 p-4 border border-theme-border rounded-lg">
                        <h5 className="text-theme-text-primary font-semibold">Dati Proprietario / Garante</h5>
                        {/* Toggle between Select Customer and New */}
                        <div className="flex items-center gap-4 mb-4">
                          <button
                            type="button"
                            onClick={() => setNewGaranteMode(false)}
                            className={`px-4 py-2 rounded-full ${!newGaranteMode ? 'bg-dr7-gold text-white font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                          >
                            Seleziona Cliente
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewGaranteMode(true)}
                            className={`px-4 py-2 rounded-full ${newGaranteMode ? 'bg-dr7-gold text-white font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                          >
                            Nuovo
                          </button>
                        </div>

                        {newGaranteMode ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input label="Nome *" required value={formData.garante_nome} onChange={(e) => setFormData(prev => ({ ...prev, garante_nome: e.target.value }))} />
                            <Input label="Cognome *" required value={formData.garante_cognome} onChange={(e) => setFormData(prev => ({ ...prev, garante_cognome: e.target.value }))} />
                            <div>
                              <label className="block text-sm font-medium text-theme-text-primary mb-2">Codice Fiscale *</label>
                              <div className="flex gap-2">
                                <input
                                  required
                                  value={formData.garante_codice_fiscale}
                                  onChange={(e) => setFormData(prev => ({ ...prev, garante_codice_fiscale: e.target.value.toUpperCase() }))}
                                  className="flex-1 px-3 py-2 min-h-[44px] bg-theme-bg-primary border border-dr7-gold/30 rounded text-base sm:text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors uppercase"
                                />
                                <CalcolaCFButton
                                  className="px-3 py-2 bg-dr7-gold hover:bg-dr7-gold/80 text-white text-xs font-medium rounded whitespace-nowrap transition-colors"
                                  config={{
                                    getCognome: () => formData.garante_cognome,
                                    getNome: () => formData.garante_nome,
                                    getDataNascita: () => formData.garante_birth_date,
                                    getSesso: () => formData.garante_sesso,
                                    getLuogoNascita: () => formData.garante_birth_place,
                                    getCodiceFiscale: () => formData.garante_codice_fiscale,
                                    setCodiceFiscale: (v) => setFormData(p => ({ ...p, garante_codice_fiscale: v })),
                                    setSesso: (v) => setFormData(p => ({ ...p, garante_sesso: v })),
                                    setDataNascita: (v) => setFormData(p => ({ ...p, garante_birth_date: v })),
                                    setLuogoNascita: (v) => setFormData(p => ({ ...p, garante_birth_place: v })),
                                    setProvinciaNascita: (v) => setFormData(p => ({ ...p, garante_birth_provincia: v })),
                                  }}
                                />
                              </div>
                            </div>
                            <Select label="Sesso" value={formData.garante_sesso} onChange={(e) => setFormData(prev => ({ ...prev, garante_sesso: e.target.value }))} options={[{ value: '', label: 'Seleziona...' }, { value: 'M', label: 'M' }, { value: 'F', label: 'F' }]} />
                            <Input label="Indirizzo" value={formData.garante_indirizzo} onChange={(e) => setFormData(prev => ({ ...prev, garante_indirizzo: e.target.value }))} />
                            <Input label="CAP" value={formData.garante_cap} onChange={(e) => setFormData(prev => ({ ...prev, garante_cap: e.target.value }))} maxLength={5} />
                            <Input label="Città" value={formData.garante_citta} onChange={(e) => setFormData(prev => ({ ...prev, garante_citta: e.target.value }))} />
                            <Input label="Provincia" value={formData.garante_provincia} onChange={(e) => setFormData(prev => ({ ...prev, garante_provincia: e.target.value.toUpperCase() }))} maxLength={2} />
                            <Input label="Data di Nascita" type="date" value={formData.garante_birth_date} onChange={(e) => setFormData(prev => ({ ...prev, garante_birth_date: e.target.value }))} />
                            <Input label="Luogo di Nascita" value={formData.garante_birth_place} onChange={(e) => setFormData(prev => ({ ...prev, garante_birth_place: e.target.value }))} />
                            <Input label="Provincia di Nascita" value={formData.garante_birth_provincia} onChange={(e) => setFormData(prev => ({ ...prev, garante_birth_provincia: e.target.value.toUpperCase() }))} maxLength={2} />
                            <Input label="Telefono" value={formData.garante_phone} onChange={(e) => setFormData(prev => ({ ...prev, garante_phone: e.target.value }))} />
                            <Input label="Email" type="email" value={formData.garante_email} onChange={(e) => setFormData(prev => ({ ...prev, garante_email: e.target.value }))} />
                          </div>
                        ) : (
                          <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cerca Cliente per Garante</label>
                            <CustomerAutocomplete
                              customers={customers}
                              selectedCustomerId={formData.garante_customer_id}
                              onSelectCustomer={(customerId) => setFormData(prev => ({ ...prev, garante_customer_id: customerId }))}
                              placeholder="Inizia a scrivere nome, email o telefono..."
                              required={false}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Home Delivery Section */}
            <div className="md:col-span-2 p-4 rounded-lg border border-theme-border">
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="delivery_enabled"
                  checked={formData.delivery_enabled}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setFormData(prev => ({
                      ...prev,
                      delivery_enabled: checked,
                      ...(!checked && {
                        delivery_street: '', delivery_city: '', delivery_zip: '',
                        delivery_province: '', delivery_notes: '', delivery_fee: '0'
                      })
                    }))
                  }}
                  className="w-4 h-4 text-dr7-gold bg-theme-bg-tertiary border-theme-border-light rounded focus:ring-dr7-gold focus:ring-offset-gray-800"
                />
                <label htmlFor="delivery_enabled" className="ml-2 text-sm font-medium text-theme-text-secondary">
                  Consegna a domicilio
                </label>
              </div>

              {formData.delivery_enabled && (
                <div className="space-y-4 animate-fadeIn">
                  <h4 className="text-theme-text-primary font-semibold text-sm">Indirizzo di consegna</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Via e numero civico *"
                      required
                      value={formData.delivery_street}
                      onChange={(e) => setFormData(prev => ({ ...prev, delivery_street: e.target.value }))}
                      placeholder="es. Via Roma, 15"
                    />
                    <Input
                      label="Città *"
                      required
                      value={formData.delivery_city}
                      onChange={(e) => setFormData(prev => ({ ...prev, delivery_city: e.target.value }))}
                      placeholder="es. Cagliari"
                    />
                    <Input
                      label="CAP *"
                      required
                      value={formData.delivery_zip}
                      onChange={(e) => setFormData(prev => ({ ...prev, delivery_zip: e.target.value }))}
                      placeholder="es. 09131"
                      maxLength={5}
                    />
                    <Input
                      label="Provincia *"
                      required
                      value={formData.delivery_province}
                      onChange={(e) => setFormData(prev => ({ ...prev, delivery_province: e.target.value.toUpperCase() }))}
                      placeholder="es. CA"
                      maxLength={2}
                    />
                    <div className="md:col-span-2">
                      <Input
                        label="Note / istruzioni"
                        value={formData.delivery_notes}
                        onChange={(e) => setFormData(prev => ({ ...prev, delivery_notes: e.target.value }))}
                        placeholder="es. Citofono 3, secondo piano"
                      />
                    </div>
                  </div>
                  <Input
                    label="Costo consegna (€) *"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formData.delivery_fee}
                    onChange={(e) => { const v = e.target.value; setFormData(prev => ({ ...prev, delivery_fee: v })) }}
                    placeholder="0.00"
                  />
                </div>
              )}
            </div>

            {/* Home Pickup Section */}
            <div className="md:col-span-2 p-4 rounded-lg border border-theme-border">
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="pickup_enabled"
                  checked={formData.pickup_enabled}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setFormData(prev => ({
                      ...prev,
                      pickup_enabled: checked,
                      ...(!checked && {
                        pickup_street: '', pickup_city: '', pickup_zip: '',
                        pickup_province: '', pickup_notes: '', pickup_fee: '0'
                      })
                    }))
                  }}
                  className="w-4 h-4 text-dr7-gold bg-theme-bg-tertiary border-theme-border-light rounded focus:ring-dr7-gold focus:ring-offset-gray-800"
                />
                <label htmlFor="pickup_enabled" className="ml-2 text-sm font-medium text-theme-text-secondary">
                  Ritiro a domicilio (check-out)
                </label>
              </div>

              {formData.pickup_enabled && (
                <div className="space-y-4 animate-fadeIn">
                  <h4 className="text-theme-text-primary font-semibold text-sm">Indirizzo di ritiro</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Via e numero civico *"
                      required
                      value={formData.pickup_street}
                      onChange={(e) => setFormData(prev => ({ ...prev, pickup_street: e.target.value }))}
                      placeholder="es. Via Roma, 15"
                    />
                    <Input
                      label="Città *"
                      required
                      value={formData.pickup_city}
                      onChange={(e) => setFormData(prev => ({ ...prev, pickup_city: e.target.value }))}
                      placeholder="es. Cagliari"
                    />
                    <Input
                      label="CAP *"
                      required
                      value={formData.pickup_zip}
                      onChange={(e) => setFormData(prev => ({ ...prev, pickup_zip: e.target.value }))}
                      placeholder="es. 09131"
                      maxLength={5}
                    />
                    <Input
                      label="Provincia *"
                      required
                      value={formData.pickup_province}
                      onChange={(e) => setFormData(prev => ({ ...prev, pickup_province: e.target.value.toUpperCase() }))}
                      placeholder="es. CA"
                      maxLength={2}
                    />
                    <div className="md:col-span-2">
                      <Input
                        label="Note / istruzioni"
                        value={formData.pickup_notes}
                        onChange={(e) => setFormData(prev => ({ ...prev, pickup_notes: e.target.value }))}
                        placeholder="es. Citofono 3, secondo piano"
                      />
                    </div>
                  </div>
                  <Input
                    label="Costo ritiro (€) *"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formData.pickup_fee}
                    onChange={(e) => { const v = e.target.value; setFormData(prev => ({ ...prev, pickup_fee: v })) }}
                    placeholder="0.00"
                  />
                </div>
              )}
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
                    // Full payment = base + delivery fee + pickup fee (cents-based to avoid float drift)
                    const fullTotalCents = eurToCents(formData.total_amount || '0')
                      + (formData.delivery_enabled ? eurToCents(formData.delivery_fee || '0') : 0)
                      + (formData.pickup_enabled ? eurToCents(formData.pickup_fee || '0') : 0)
                    newAmountPaid = centsToEurStr(fullTotalCents)
                  } else if (newStatus === 'unpaid') {
                    newAmountPaid = '0' // No payment
                  }
                  // If 'pending' (Da Saldare), leave amount_paid as is (allows partial)

                  setFormData({
                    ...formData,
                    payment_status: newStatus,
                    amount_paid: newAmountPaid,
                    // Map payment status to booking status consistently
                    status: newStatus === 'paid' ? 'confirmed'
                      : (formData.payment_method === 'Nexi Pay by Link' ? 'pending' : 'confirmed'),
                    payment_method: newStatus === 'unpaid' ? '' : formData.payment_method
                  })
                }}
                options={[
                  { value: 'pending', label: 'Da Saldare' },
                  { value: 'partial', label: 'Parziale' },
                  { value: 'paid', label: 'Pagato' }
                ]}
              />
              {(
                <Select
                  label="Metodo di Pagamento"
                  required
                  value={formData.payment_method}
                  onChange={(e) => {
                    const method = e.target.value
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const updates: any = { payment_method: method }
                    // Nexi Pay by Link = always pending until customer pays
                    if (method === 'Nexi Pay by Link') {
                      updates.payment_status = 'pending'
                      updates.status = 'pending'
                      updates.amount_paid = '0'
                    }
                    setFormData(prev => ({ ...prev, ...updates }))
                  }}
                  options={[
                    { value: 'Nexi Pay by Link', label: 'Nexi - Pay by Link' },
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
              {/* Revenue Management — Prezzo Suggerito/Auto */}
              {(revenueSuggestion || revenueLoading) && (
                <div className={`border rounded-lg p-3 space-y-2 ${
                  revenueSuggestion?.mode === 'auto_apply'
                    ? 'border-green-500/40 bg-green-500/5'
                    : 'border-amber-500/40 bg-amber-500/5'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${
                      revenueSuggestion?.mode === 'auto_apply' ? 'text-green-400' : 'text-amber-400'
                    }`}>
                      {revenueLoading ? 'Calcolo prezzo...' :
                       revenueSuggestion?.mode === 'auto_apply' ? 'Prezzo Dinamico (Auto)' : 'Prezzo Suggerito'}
                    </span>
                    {revenueSuggestion && (
                      <div className="flex items-center gap-2">
                        {(() => {
                          const sv = vehicles.find(v => v.id === formData.vehicle_id)
                          const activeTier = customerTier?.tier || 'TIER_1'
                          const ko = sv ? getInsuranceOptions(sv, activeTier, configOverlay, rentalConfig) : []
                          const sk = ko.find(k => k.id === formData.insurance_option)
                          const insTotal = (sk?.pricePerDay || 0) * revenueSuggestion.rentalDays
                          const deliveryFees = (formData.delivery_enabled ? parseFloat(formData.delivery_fee || '0') : 0)
                            + (formData.pickup_enabled ? parseFloat(formData.pickup_fee || '0') : 0)
                          const dpSurchargePerDay = selectedDepositSurchargePerDay
                            || (formData.deposit_status === 'no_cauzione' ? CFG_NO_CAUZIONE_PER_DAY : 0)
                          const noCauzioneCost = dpSurchargePerDay * revenueSuggestion.rentalDays
                          const unlimitedKmCost = formData.unlimited_km
                            ? getUnlimitedKmPriceRes(sv, activeTier) * revenueSuggestion.rentalDays : 0
                          const secondDriverCost = formData.has_second_driver
                            ? (activeTier === 'TIER_2' ? CFG_SECOND_DRIVER.TIER_2 : CFG_SECOND_DRIVER.TIER_1) * revenueSuggestion.rentalDays : 0
                          const experienceCost = calculateExperienceCost(formData.experience_services, revenueSuggestion.rentalDays)
                          const flexCost = formData.dr7_flex && activeTier === 'TIER_2' ? CFG_DR7_FLEX_PER_DAY * revenueSuggestion.rentalDays : 0
                          // List price (no coefficients). Experience excluded from
                          // the clamp-eligible subtotal.
                          const listDailyRate = revenueSuggestion.selectedBaseRateEur || getDailyRateFromConfig(sv, revenueSuggestion.rentalDays)
                          const listRentalTotal = listDailyRate * revenueSuggestion.rentalDays
                          const listSubtotalNoExp = listRentalTotal + insTotal + deliveryFees + CFG_LAVAGGIO_FEE + noCauzioneCost + unlimitedKmCost + secondDriverCost + flexCost
                          const listSubtotal = listSubtotalNoExp + experienceCost
                          const combinedCoeff = (revenueSuggestion.breakdown || []).reduce((acc: number, b: { coeff: number }) => acc * b.coeff, 1)
                          const rawAfterCoeffNoExp = listSubtotalNoExp * combinedCoeff
                          // Experience stays at LIST PRICE — no coefficient, no clamp.
                          // Min/Max clamp on the no-experience subtotal.
                          const minDaily = typeof revenueSuggestion.minPrice === 'number' ? revenueSuggestion.minPrice : null
                          const maxDaily = typeof revenueSuggestion.maxPrice === 'number' ? revenueSuggestion.maxPrice : null
                          const maxTotal = maxDaily != null ? maxDaily * revenueSuggestion.rentalDays : null
                          const minTotal = minDaily != null ? minDaily * revenueSuggestion.rentalDays : null
                          let clampedNoExp = rawAfterCoeffNoExp
                          let clampHit: 'min' | 'max' | null = null
                          if (maxTotal != null && clampedNoExp > maxTotal) { clampedNoExp = maxTotal; clampHit = 'max' }
                          if (minTotal != null && clampedNoExp < minTotal) { clampedNoExp = minTotal; clampHit = 'min' }
                          const uncappedSubtotal = Math.round((rawAfterCoeffNoExp + experienceCost) * 100) / 100
                          const dynamicSubtotal = Math.round((clampedNoExp + experienceCost) * 100) / 100
                          const grandTotal = formData.payment_method === 'Contanti' ? dynamicSubtotal * 1.20 : dynamicSubtotal
                          const uncappedGrand = formData.payment_method === 'Contanti' ? uncappedSubtotal * 1.20 : uncappedSubtotal
                          const hasDiscount = Math.abs(combinedCoeff - 1) > 0.001
                          const discountPct = hasDiscount ? Math.round((1 - combinedCoeff) * 100) : 0
                          const listGrandTotal = formData.payment_method === 'Contanti' ? listSubtotal * 1.20 : listSubtotal
                          return (
                            <>
                              {hasDiscount && (
                                <span className="text-sm text-theme-text-muted line-through">
                                  EUR {listGrandTotal.toFixed(2)}
                                </span>
                              )}
                              {clampHit && (
                                <span className="text-xs text-yellow-400" title={`Uncapped: EUR ${uncappedGrand.toFixed(2)} · Limite ${clampHit === 'max' ? 'Max' : 'Min'}: EUR ${(clampHit === 'max' ? maxDaily! : minDaily!).toFixed(2)}/g x ${revenueSuggestion.rentalDays}gg (escl. experience)`}>
                                  ⚠️ Limite {clampHit === 'max' ? 'Max' : 'Min'} raggiunto
                                </span>
                              )}
                              <span className={`text-lg font-bold ${
                                revenueSuggestion.mode === 'auto_apply' ? 'text-green-400' : 'text-amber-400'
                              }`}>
                                EUR {grandTotal.toFixed(2)}
                              </span>
                              {hasDiscount && (
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${discountPct > 0 ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'}`}>
                                  {discountPct > 0 ? `-${discountPct}%` : `+${Math.abs(discountPct)}%`}
                                </span>
                              )}
                              {revenueSuggestion.mode !== 'auto_apply' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFormData(prev => ({ ...prev, total_amount: grandTotal.toFixed(2) }))
                                  }}
                                  className="text-xs px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded transition-colors"
                                >
                                  Applica
                                </button>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                  {revenueSuggestion && (
                    <>
                      <div className="text-xs text-theme-text-muted">
                        EUR {centsToEurStr(Math.round(revenueSuggestion.finalDailyRateEur * 100))}/giorno x {revenueSuggestion.rentalDays} giorni
                        {' '}({revenueSuggestion.selectedBaseRateSource === 'vehicle_override' ? 'override veicolo' :
                              revenueSuggestion.selectedBaseRateSource === 'category_override' ? 'override categoria' : 'tariffa base'})
                        {revenueSuggestion.minHit && ' | Min raggiunto'}
                        {revenueSuggestion.maxHit && ' | Max raggiunto'}
                      </div>
                      <button
                        type="button"
                        onClick={() => setRevenueExpanded(!revenueExpanded)}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        {revenueExpanded ? 'Nascondi dettagli' : 'Mostra dettagli'}
                      </button>
                      {revenueExpanded && (
                        <div className="space-y-1 pt-1 border-t border-theme-border">
                          <div className="flex justify-between text-xs">
                            <span className="text-theme-text-muted">Base selezionata</span>
                            <span className="text-theme-text-primary">EUR {revenueSuggestion.selectedBaseRateEur.toFixed(2)}/g</span>
                          </div>
                        {revenueSuggestion.breakdown.map((item, i) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span className="text-theme-text-muted">{item.label} ({item.description})</span>
                            <span className={`font-mono ${item.coeff > 1 ? 'text-red-400' : item.coeff < 1 ? 'text-green-400' : 'text-theme-text-primary'}`}>
                              x{item.coeff.toFixed(2)}
                            </span>
                          </div>
                        ))}
                        {(() => {
                          const sv = vehicles.find(v => v.id === formData.vehicle_id)
                          const at = customerTier?.tier || 'TIER_1'
                          const ko = sv ? getInsuranceOptions(sv, at, configOverlay, rentalConfig) : []
                          const sk = ko.find(k => k.id === formData.insurance_option)
                          if (!sk || sk.pricePerDay === 0) return null
                          return (
                            <div className="flex justify-between text-xs pt-1 border-t border-theme-border/50">
                              <span className="text-theme-text-muted">Assicurazione ({sk.label})</span>
                              <span className="text-blue-400 font-mono">+EUR {(sk.pricePerDay * revenueSuggestion.rentalDays).toFixed(2)}</span>
                            </div>
                          )
                        })()}
                        {formData.deposit_status === 'no_cauzione' && (
                          <div className="flex justify-between text-xs pt-1 border-t border-theme-border/50">
                            <span className="text-theme-text-muted">No Cauzione (+€{CFG_NO_CAUZIONE_PER_DAY}/g)</span>
                            <span className="text-red-400 font-mono">+EUR {(CFG_NO_CAUZIONE_PER_DAY * revenueSuggestion.rentalDays).toFixed(2)}</span>
                          </div>
                        )}
                        {formData.unlimited_km && (() => {
                          const sv = vehicles.find(v => v.id === formData.vehicle_id)
                          if (!sv) return null
                          const at = customerTier?.tier || 'TIER_1'
                          const kmPrice = getUnlimitedKmPriceRes(sv, at)
                          if (kmPrice === 0) return null // Urban: KM already unlimited
                          return (
                            <div className="flex justify-between text-xs pt-1 border-t border-theme-border/50">
                              <span className="text-theme-text-muted">KM Illimitati (+€{kmPrice}/g)</span>
                              <span className="text-red-400 font-mono">+EUR {(kmPrice * revenueSuggestion.rentalDays).toFixed(2)}</span>
                            </div>
                          )
                        })()}
                        <div className="flex justify-between text-xs pt-1 border-t border-theme-border/50">
                          <span className="text-theme-text-muted">Lavaggio</span>
                          <span className="text-blue-400 font-mono">+EUR {CFG_LAVAGGIO_FEE.toFixed(2)}</span>
                        </div>
                        {(formData.delivery_enabled && parseFloat(formData.delivery_fee || '0') > 0) && (
                          <div className="flex justify-between text-xs pt-1 border-t border-theme-border/50">
                            <span className="text-theme-text-muted">Consegna ({formData.pickup_location === 'cagliari_airport' ? 'Aeroporto' : 'Domicilio'})</span>
                            <span className="text-blue-400 font-mono">+EUR {parseFloat(formData.delivery_fee).toFixed(2)}</span>
                          </div>
                        )}
                        {(formData.pickup_enabled && parseFloat(formData.pickup_fee || '0') > 0) && (
                          <div className="flex justify-between text-xs">
                            <span className="text-theme-text-muted">Ritiro ({formData.dropoff_location === 'cagliari_airport' ? 'Aeroporto' : 'Domicilio'})</span>
                            <span className="text-blue-400 font-mono">+EUR {parseFloat(formData.pickup_fee).toFixed(2)}</span>
                          </div>
                        )}
                        {formData.payment_method === 'Contanti' && (
                          <div className="flex justify-between text-xs pt-1 border-t border-theme-border/50">
                            <span className="text-theme-text-muted">Maggiorazione contanti</span>
                            <span className="text-red-400 font-mono">+20%</span>
                          </div>
                        )}
                      </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {/* Experience Services & DR7 Flex */}
              <div className="md:col-span-2 p-4 rounded-lg border border-theme-border">
                <h4 className="text-theme-text-primary font-semibold mb-3">Servizi Experience</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(() => {
                    const tier = customerTier?.tier || 'TIER_1'
                    const availableServices = getExperienceServicesForTier(tier)
                    return availableServices.map(svc => {
                      const qty = formData.experience_services[svc.id] || 0
                      const unitLabel = svc.unit === 'per_day' ? '/giorno' : svc.unit === 'per_hour' ? '/ora' : svc.unit === 'per_item' ? '/unità' : ''
                      return (
                        <div key={svc.id} className={`flex items-center justify-between p-2 rounded-md border ${qty > 0 ? 'border-dr7-gold bg-dr7-gold/5' : 'border-theme-border'}`}>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-theme-text-primary">{svc.name}</span>
                            <span className="text-xs text-theme-text-muted ml-1">€{svc.price.toFixed(2)}{unitLabel}</span>
                          </div>
                          {(svc.unit === 'per_item' || svc.unit === 'per_hour') ? (
                            <div className="flex items-center gap-1 ml-2">
                              <button type="button" onClick={() => setFormData(prev => {
                                const es = { ...prev.experience_services }
                                if ((es[svc.id] || 0) > 0) es[svc.id] = (es[svc.id] || 0) - 1
                                if (es[svc.id] === 0) delete es[svc.id]
                                return { ...prev, experience_services: es }
                              })} className="w-6 h-6 rounded bg-theme-bg-tertiary text-theme-text-primary border border-theme-border text-sm">-</button>
                              <span className="w-6 text-center text-sm text-theme-text-primary">{qty}</span>
                              <button type="button" onClick={() => setFormData(prev => {
                                const es = { ...prev.experience_services }
                                es[svc.id] = (es[svc.id] || 0) + 1
                                return { ...prev, experience_services: es }
                              })} className="w-6 h-6 rounded bg-theme-bg-tertiary text-theme-text-primary border border-theme-border text-sm">+</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setFormData(prev => {
                              const es = { ...prev.experience_services }
                              if (es[svc.id]) delete es[svc.id]
                              else es[svc.id] = 1
                              return { ...prev, experience_services: es }
                            })} className={`ml-2 px-3 py-1 rounded text-xs font-medium ${qty > 0 ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary border border-theme-border'}`}>
                              {qty > 0 ? 'Aggiunto' : 'Aggiungi'}
                            </button>
                          )}
                        </div>
                      )
                    })
                  })()}
                </div>
                {/* DR7 FLEX — only Fascia A */}
                {(!customerTier || customerTier.tier === 'TIER_2') && (
                  <div className={`mt-3 flex items-center gap-2 p-3 rounded-lg border ${formData.dr7_flex ? 'border-green-500 bg-green-900/10' : 'border-theme-border'}`}>
                    <input
                      type="checkbox"
                      id="dr7_flex"
                      checked={formData.dr7_flex}
                      onChange={(e) => setFormData(prev => ({ ...prev, dr7_flex: e.target.checked }))}
                      className="w-4 h-4 text-green-600 bg-theme-bg-tertiary border-theme-border-light rounded focus:ring-green-500"
                    />
                    <label htmlFor="dr7_flex" className="text-sm text-theme-text-secondary cursor-pointer flex-1">
                      DR7 FLEX — Cancellazione Premium (+€{CFG_DR7_FLEX_PER_DAY.toFixed(2)}/giorno)
                    </label>
                  </div>
                )}
                {customerTier?.tier === 'TIER_1' && (
                  <p className="text-xs text-amber-400 mt-2">DR7 FLEX non disponibile per Fascia B</p>
                )}
              </div>

              <Input
                label="Importo Totale (€)"
                type="number"
                step="0.01"
                required
                value={formData.total_amount}
                onChange={(e) => {
                  const newTotal = e.target.value
                  setFormData(prev => {
                    // If currently paid, update paid amount to match new total (cents-based to avoid float drift)
                    const fullTotalCents = eurToCents(newTotal || '0')
                      + (prev.delivery_enabled ? eurToCents(prev.delivery_fee || '0') : 0)
                      + (prev.pickup_enabled ? eurToCents(prev.pickup_fee || '0') : 0)
                    const newPaid = prev.payment_status === 'paid' ? centsToEurStr(fullTotalCents) : prev.amount_paid
                    return { ...prev, total_amount: newTotal, amount_paid: newPaid }
                  })
                }}
              />
              <div>
                <Input
                  label="Sforo per KM (€)"
                  type="number"
                  step="0.01"
                  value={formData.km_overage_fee}
                  onChange={(e) => { const v = e.target.value; setFormData(prev => ({ ...prev, km_overage_fee: v })) }}
                  placeholder="es. 0.50"
                  disabled={formData.unlimited_km}
                />
                {formData.vehicle_id && !formData.unlimited_km && (() => {
                  // Mostra il default da Centralina Pro per la categoria del veicolo.
                  const sv = vehicles.find(v => v.id === formData.vehicle_id)
                  const cfgSforo = getSforoForCategory(sv, rentalConfig)
                  if (!cfgSforo) return null
                  const catLabel = sv?.category === 'exotic' ? 'Supercar' : sv?.category === 'urban' ? 'Urban' : sv?.category === 'aziendali' ? 'Aziendali' : sv?.category || ''
                  return (
                    <p className="text-xs text-amber-400 mt-1">Default Centralina ({catLabel}): €{cfgSforo}/km</p>
                  )
                })()}
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">LIMITE KM:</h4>
                {/* Show computed KM included from config formula */}
                {formData.pickup_date && formData.return_date && !formData.unlimited_km && (() => {
                  const pickup = new Date(formData.pickup_date)
                  const ret = new Date(formData.return_date)
                  const days = Math.max(1, Math.ceil((ret.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24)))
                  const selectedVeh = vehicles.find(v => v.id === formData.vehicle_id)
                  const cat = selectedVeh?.category || '_global'
                  const km = getKmIncluded(rentalConfig, days, cat)
                  if (km === 'unlimited') return <p className="text-xs text-green-400">KM illimitati inclusi per questa categoria</p>
                  return (
                    <div className="p-3 rounded-md border border-green-600/40 bg-green-900/10">
                      <span className="text-green-400 font-bold text-sm">{km} km inclusi</span>
                      <span className="text-theme-text-muted text-xs ml-2">({days} {days === 1 ? 'giorno' : 'giorni'})</span>
                    </div>
                  )
                })()}
                <div
                  className={`p-3 rounded-md border cursor-pointer transition-all flex items-center gap-2 ${formData.km_limit === DEFAULT_KM_LIMIT && !formData.unlimited_km
                    ? 'border-theme-text-primary bg-theme-text-primary/5'
                    : 'border-theme-border hover:border-theme-border'
                    } ${formData.unlimited_km ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={() => !formData.unlimited_km && setFormData(p => ({ ...p, km_limit: DEFAULT_KM_LIMIT }))}
                >
                  <span className="text-theme-text-primary font-bold text-sm">100 Km / Giorno</span>
                </div>
              </div>

              {/* Manual KM Input - Fallback if not using presets */}
              <Input
                label="Limite KM Personale"
                type="number"
                value={formData.km_limit}
                onChange={(e) => { const v = e.target.value; setFormData(prev => ({ ...prev, km_limit: v })) }}
                placeholder="es. 150 (Lascia vuoto se Illimitati)"
                disabled={formData.unlimited_km}
              />
              <div className={`flex items-center gap-2 p-3 rounded-lg border ${formData.unlimited_km ? 'border-blue-500 bg-blue-900/10' : 'border-theme-border'}`}>
                <input
                  type="checkbox"
                  id="unlimited_km"
                  checked={formData.unlimited_km}
                  onChange={(e) => {
                    const checked = e.target.checked
                    const selectedVeh = vehicles.find(v => v.id === formData.vehicle_id)
                    const sforo = getVehicleSforoOverride(rentalConfig, formData.vehicle_id) || getSforoForCategory(selectedVeh, rentalConfig)
                    setFormData(prev => ({ ...prev, unlimited_km: checked, km_overage_fee: checked ? '0' : sforo }))
                  }}
                  className="w-4 h-4 text-blue-600 bg-theme-bg-tertiary border-theme-border-light rounded focus:ring-blue-500"
                />
                <label htmlFor="unlimited_km" className="text-sm text-theme-text-secondary cursor-pointer">
                  KM Illimitati
                  {(() => {
                    const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)
                    if (selectedVehicle) {
                      const tier = customerTier?.tier
                      const price = getUnlimitedKmPriceRes(selectedVehicle, tier)
                      // Diagnostic log — verifica quale prezzo stiamo leggendo da Centralina
                      console.log('[ReservationsTab] KM Illimitati lookup', {
                        vehicleName: selectedVehicle.display_name,
                        category: selectedVehicle.category,
                        customerTier: tier,
                        priceReturned: price,
                        rentalConfigUnlimitedExotic: rentalConfig?.unlimited_km?.exotic,
                      })
                      if (price === 0) return null // Urban: KM already unlimited
                      return ` (+€${price}/giorno)`
                    }
                    return ''
                  })()}
                </label>
              </div>

              {/* Conferma Prenotazione — non scade dopo 1h, visibile in rosso con nome cliente */}
              {formData.payment_status !== 'paid' && formData.payment_status !== 'completed' && formData.payment_status !== 'succeeded' && (
                <div className={`flex items-start gap-2 p-3 rounded-lg border ${confirmBooking ? 'border-red-500 bg-red-900/10' : 'border-theme-border'}`}>
                  <input
                    type="checkbox"
                    id="confirm_booking"
                    checked={confirmBooking}
                    onChange={(e) => setConfirmBooking(e.target.checked)}
                    className="w-4 h-4 mt-0.5 text-red-600 bg-theme-bg-tertiary border-theme-border-light rounded focus:ring-red-500"
                  />
                  <label htmlFor="confirm_booking" className="text-sm text-theme-text-secondary cursor-pointer">
                    <span className="font-semibold text-red-400">Conferma Prenotazione</span>
                    <span className="block text-xs text-theme-text-muted mt-0.5">La prenotazione NON scadrà dopo 1h. In calendario apparirà in rosso con il nome del cliente invece di "Da Saldare".</span>
                  </label>
                </div>
              )}

              <Input
                label="Importo Pagato (€)"
                type="number"
                step="0.01"
                required
                value={formData.amount_paid}
                onChange={(e) => {
                  // Simply update the amount_paid without auto-calculating payment_status
                  // The user controls payment_status via the dropdown above
                  setFormData({
                    ...formData,
                    amount_paid: e.target.value
                  })
                }}
              />
              <Input
                label="Valuta"
                value={formData.currency}
                onChange={(e) => { const v = e.target.value; setFormData(prev => ({ ...prev, currency: v })) }}
              />
            </div>

            {/* Note */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Note (opzionale)</label>
              <textarea
                value={formData.notes}
                onChange={(e) => { const v = e.target.value; setFormData(prev => ({ ...prev, notes: v })) }}
                placeholder="Note interne sulla prenotazione..."
                rows={2}
                className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary placeholder-theme-text-muted/50 focus:outline-none focus:ring-1 focus:ring-dr7-gold text-sm resize-none"
              />
            </div>

            {/* Riepilogo Totale - shows breakdown with delivery/pickup fees */}
            {(formData.delivery_enabled || formData.pickup_enabled) && (
              <div className="md:col-span-2 bg-theme-text-primary/5 rounded-lg p-4 border border-theme-border/50">
                <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-3">Riepilogo Totale</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-theme-text-muted">Noleggio base</span>
                    <span className="font-mono text-theme-text-primary">€{centsToEurStr(eurToCents(formData.total_amount || '0'))}</span>
                  </div>
                  {formData.delivery_enabled && (
                    <div className="flex justify-between items-center">
                      <span className="text-theme-text-muted">Consegna a domicilio</span>
                      <span className="font-mono text-theme-text-primary">€{centsToEurStr(eurToCents(formData.delivery_fee || '0'))}</span>
                    </div>
                  )}
                  {formData.pickup_enabled && (
                    <div className="flex justify-between items-center">
                      <span className="text-theme-text-muted">Ritiro a domicilio</span>
                      <span className="font-mono text-theme-text-primary">€{centsToEurStr(eurToCents(formData.pickup_fee || '0'))}</span>
                    </div>
                  )}
                  <div className="border-t border-theme-border/50 pt-2 mt-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-dr7-gold">Totale da saldare</span>
                      <span className="font-mono text-xl font-bold text-dr7-gold">
                        €{centsToEurStr(
                          eurToCents(formData.total_amount || '0') +
                          (formData.delivery_enabled ? eurToCents(formData.delivery_fee || '0') : 0) +
                          (formData.pickup_enabled ? eurToCents(formData.pickup_fee || '0') : 0)
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3 mt-4">
              <Button type="submit" disabled={isSubmitting} className="flex-1 sm:flex-none">
                {isSubmitting ? 'Salvataggio...' : 'Salva'}
              </Button>
              <Button type="button" variant="secondary" className="flex-1 sm:flex-none" onClick={() => { setShowForm(false); setEditingId(null); setNewCustomerMode(false); setConfirmBooking(false); resetForm() }}>
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
            const words = bookingSearchQuery.toLowerCase().split(/\s+/).filter(Boolean)
            const customerName = (booking.booking_details?.customer?.fullName || booking.customer_name || '').toLowerCase()
            const customerEmail = (booking.customer_email || booking.booking_details?.customer?.email || '').toLowerCase()
            const customerPhone = (booking.customer_phone || booking.booking_details?.customer?.phone || '').toLowerCase()
            const vehicleName = (booking.vehicle_name || '').toLowerCase()
            const vehiclePlate = (booking.vehicle_plate || '').toLowerCase()
            const bookingId = String(booking.id || '').toLowerCase()
            const bookingCode = bookingId.substring(0, 8)
            const norm = (s: string) => s.replace(/[\s\-\+\(\)]/g, '')
            const normalisedWords = words.map(norm)
            const searchText = norm(`${customerName} ${customerEmail} ${customerPhone} ${vehicleName} ${vehiclePlate} ${bookingId} ${bookingCode} dr7${bookingCode}`)
            return normalisedWords.every(word => searchText.includes(word))
          }).length === 0 && (
              <div className="rounded-lg border border-theme-border/30 p-8 text-center text-theme-text-muted">
                {bookingSearchQuery ? `Nessuna prenotazione trovata per "${bookingSearchQuery}"` : 'Nessuna prenotazione trovata'}
              </div>
            )}

          {/* Display bookings as cards on mobile */}
          {bookings.filter(booking => {
            // Search filter
            if (!bookingSearchQuery) return true
            const words = bookingSearchQuery.toLowerCase().split(/\s+/).filter(Boolean)
            const customerName = (booking.booking_details?.customer?.fullName || booking.customer_name || '').toLowerCase()
            const customerEmail = (booking.customer_email || booking.booking_details?.customer?.email || '').toLowerCase()
            const customerPhone = (booking.customer_phone || booking.booking_details?.customer?.phone || '').toLowerCase()
            const vehicleName = (booking.vehicle_name || '').toLowerCase()
            const vehiclePlate = (booking.vehicle_plate || '').toLowerCase()
            const bookingId = String(booking.id || '').toLowerCase()
            const bookingCode = bookingId.substring(0, 8)
            const norm = (s: string) => s.replace(/[\s\-\+\(\)]/g, '')
            const normalisedWords = words.map(norm)
            const searchText = norm(`${customerName} ${customerEmail} ${customerPhone} ${vehicleName} ${vehiclePlate} ${bookingId} ${bookingCode} dr7${bookingCode}`)
            return normalisedWords.every(word => searchText.includes(word))
          }).map((booking) => {
            const isCarWash = booking.service_type === 'car_wash'
            return (
              <div
                key={`booking-card-${booking.id}`}
                className="rounded-lg p-4 cursor-pointer hover:bg-theme-text-primary/5 transition-colors border border-theme-border/30"
                onClick={() => setSelectedBooking(booking)}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <div className="font-semibold text-theme-text-primary mb-1 flex items-center">
                      {booking.booking_details?.customer?.fullName || booking.customer_name || 'N/A'}
                      <CustomerStatusBadge email={booking.customer_email || booking.booking_details?.customer?.email} statusMap={customerStatuses} />
                      {((booking.user_id && clubMembers.has(booking.user_id)) || (booking.customer_email && clubEmails.has(booking.customer_email.toLowerCase()))) && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold border bg-[#C9A96E]/20 text-[#D4B896] border-[#C9A96E]/50">DR7 Club</span>
                      )}
                    </div>
                    <div className="text-sm text-theme-text-muted">{booking.customer_phone || booking.booking_details?.customer?.phone || '-'}</div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${booking.payment_status === 'completed' ||
                    booking.payment_status === 'paid' ||
                    booking.payment_status === 'succeeded' ||
                    (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                    ? 'bg-green-900 text-green-300'
                    : booking.payment_status === 'partial'
                    ? 'bg-amber-900 text-amber-300'
                    : 'bg-red-900 text-red-300'
                    }`}>
                    {booking.payment_status === 'completed' ||
                      booking.payment_status === 'paid' ||
                      booking.payment_status === 'succeeded' ||
                      (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                      ? <>Pagato{booking.payment_method && <span className="ml-1 opacity-70">· {booking.payment_method}</span>}</>
                      : booking.payment_status === 'partial'
                      ? `Parziale €${((booking.amount_paid || 0) / 100).toFixed(0)}`
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
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditBooking(booking) }}
                        className="px-3 py-1 min-h-[44px] bg-blue-600/30 hover:bg-blue-600/50 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap"
                      >
                        Modifica
                      </button>
                      {!isCarWash && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleExtendBooking(booking) }}
                          className="px-3 py-1 min-h-[44px] bg-purple-600/30 hover:bg-purple-600/50 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap"
                        >
                          Estendi
                        </button>
                      )}
                    </div>

                    {/* Contract Actions */}
                    {booking.booking_details?.contract_generated_at || booking.contract_url ? (
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); window.open(booking.contract_url, '_blank') }}
                          className="px-3 py-1 min-h-[44px] bg-green-600/30 hover:bg-green-600/50 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap flex items-center gap-1"
                          title="Visualizza Contratto"
                        >
                          Contratto
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleResendContract(booking) }}
                          className="px-3 py-1 min-h-[44px] bg-orange-600/30 hover:bg-orange-600/50 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap flex items-center gap-1"
                          title="Invia link firma contratto via WhatsApp"
                        >
                          Invia Contratto
                        </button>
                        {/* Fattura Button (Mobile) */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleGenerateInvoice(booking) }}
                          disabled={generatingInvoice}
                          className={`px-3 py-1 min-h-[44px] ${generatingInvoice ? 'bg-theme-bg-hover text-theme-text-secondary' : 'bg-blue-600/30 hover:bg-blue-600/50 text-theme-text-primary'} text-sm rounded-full transition-colors whitespace-nowrap flex items-center gap-1`}
                          title="Fattura"
                        >
                          {generatingInvoice ? 'Generazione...' : 'Fattura'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleGenerateContract(booking) }}
                        disabled={generatingContract}
                        className={`px-3 py-1 min-h-[44px] ${generatingContract ? 'bg-theme-bg-hover text-theme-text-secondary' : 'bg-dr7-gold hover:bg-[#247a6f] text-theme-text-primary'} text-sm rounded-full transition-colors whitespace-nowrap flex items-center gap-1`}
                      >
                        {generatingContract ? 'Generazione...' : 'Contratto'}
                      </button>
                    )}


                    {booking.payment_status !== 'paid' && booking.payment_status !== 'completed' && booking.payment_status !== 'succeeded' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResendPaymentLink(booking) }}
                        className="px-3 py-1 min-h-[44px] bg-orange-500/30 hover:bg-orange-500/50 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap"
                      >
                        {booking.booking_details?.nexi_payment_link ? 'Rinvia Link' : 'Genera Link'}
                      </button>
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedBookingForDanniPenali(booking); setDanniPenaliInitialTab('danni'); setDanniPenaliModalOpen(true) }}
                      className="px-3 py-1 min-h-[44px] bg-gradient-to-r from-red-600/30 to-dr7-gold/30 hover:from-red-600/50 hover:to-dr7-gold/50 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap"
                    >
                      Danni & Penali
                    </button>

                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteBooking(booking.id, 'booking') }}
                      className="px-3 py-1 min-h-[44px] bg-red-600/30 hover:bg-red-600/50 rounded-full text-theme-text-primary text-sm transition-colors whitespace-nowrap w-full"
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
        <div className="hidden lg:block rounded-lg overflow-x-auto">
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
                  const words = bookingSearchQuery.toLowerCase().split(/\s+/).filter(Boolean)
                  const customerName = (booking.booking_details?.customer?.fullName || booking.customer_name || '').toLowerCase()
                  const customerEmail = (booking.customer_email || booking.booking_details?.customer?.email || '').toLowerCase()
                  const customerPhone = (booking.customer_phone || booking.booking_details?.customer?.phone || '').toLowerCase()
                  const vehicleName = (booking.vehicle_name || '').toLowerCase()
                  const vehiclePlate = (booking.vehicle_plate || '').toLowerCase()
                  const bookingId = String(booking.id || '').toLowerCase()
                  const bookingCode = bookingId.substring(0, 8)
                  const norm = (s: string) => s.replace(/[\s\-\+\(\)]/g, '')
                  const normalisedWords = words.map(norm)
                  const searchText = norm(`${customerName} ${customerEmail} ${customerPhone} ${vehicleName} ${vehiclePlate} ${bookingId} ${bookingCode} dr7${bookingCode}`)
                  return normalisedWords.every(word => searchText.includes(word))
                }).map((booking) => {
                  const isCarWash = booking.service_type === 'car_wash'
                  return (
                    <tr key={`booking-${booking.id}`} className="border-t border-theme-border hover:/50 cursor-pointer" onClick={() => setSelectedBooking(booking)}>
                      <td className="px-3 py-3 text-sm text-theme-text-primary max-w-[180px]" title={booking.booking_details?.customer?.fullName || booking.customer_name || 'N/A'}>
                        <span className="flex items-center">
                          <span className="truncate">{booking.booking_details?.customer?.fullName || booking.customer_name || 'N/A'}</span>
                          <CustomerStatusBadge email={booking.customer_email || booking.booking_details?.customer?.email} statusMap={customerStatuses} />
                      {((booking.user_id && clubMembers.has(booking.user_id)) || (booking.customer_email && clubEmails.has(booking.customer_email.toLowerCase()))) && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold border bg-[#C9A96E]/20 text-[#D4B896] border-[#C9A96E]/50">DR7 Club</span>
                      )}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-theme-text-primary whitespace-nowrap">
                        {booking.customer_phone || booking.booking_details?.customer?.phone || '-'}
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
                          booking.payment_status === 'succeeded' ||
                          (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                          ? 'bg-green-900 text-green-300'
                          : booking.payment_status === 'partial'
                          ? 'bg-amber-900 text-amber-300'
                          : 'bg-red-900 text-red-300'
                          }`}>
                          {booking.payment_status === 'completed' ||
                            booking.payment_status === 'paid' ||
                            booking.payment_status === 'succeeded' ||
                            (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
                            ? 'Pagato'
                            : booking.payment_status === 'partial'
                            ? `Parziale €${((booking.amount_paid || 0) / 100).toFixed(0)}`
                            : 'Non Pagato'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-theme-text-primary whitespace-nowrap">
                        {canViewFinancials || userEmail === 'dubai.rent7.0srl@gmail.com' ? `€${(booking.price_total / 100).toFixed(2)}` : '***'}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        <div className="flex flex-wrap gap-2 items-center">
                          {booking.status !== 'cancelled' && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); if (booking.contract_url) { window.open(booking.contract_url, '_blank') } else { handleGenerateContract(booking) } }}
                                disabled={!booking.contract_url && generatingContract}
                                className="px-3 py-1 bg-green-600/30 hover:bg-green-600/50 rounded-full text-theme-text-primary text-xs transition-colors whitespace-nowrap disabled:opacity-50"
                              >
                                {!booking.contract_url && generatingContract ? '...' : 'Contratto'}
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
                              {!isCarWash && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleExtendBooking(booking) }}
                                  className="px-3 py-1 bg-purple-600/30 hover:bg-purple-600/50 rounded-full text-theme-text-primary text-xs rounded-full transition-colors whitespace-nowrap"
                                >
                                  Estendi
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteBooking(booking.id, 'booking') }}
                                className="px-3 py-1 bg-orange-600 hover:bg-orange-700 rounded-full text-theme-text-primary text-xs rounded-full transition-colors whitespace-nowrap"
                              >
                                Cancella
                              </button>
                              {booking.contract_url && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleResendContract(booking) }}
                                  className="px-3 py-1 bg-orange-500/30 hover:bg-orange-500/50 rounded-full text-theme-text-primary text-xs transition-colors whitespace-nowrap"
                                >
                                  Invia Contratto
                                </button>
                              )}
                              {booking.payment_status !== 'paid' && booking.payment_status !== 'completed' && booking.payment_status !== 'succeeded' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleResendPaymentLink(booking) }}
                                  className="px-3 py-1 bg-orange-500/30 hover:bg-orange-500/50 rounded-full text-theme-text-primary text-xs transition-colors whitespace-nowrap"
                                >
                                  {booking.booking_details?.nexi_payment_link ? 'Rinvia Link' : 'Genera Link'}
                                </button>
                              )}
                            </>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedBookingForDanniPenali(booking); setDanniPenaliInitialTab('danni'); setDanniPenaliModalOpen(true) }}
                            className="px-3 py-1 bg-gradient-to-r from-red-600/30 to-dr7-gold/30 hover:from-red-600/50 hover:to-dr7-gold/50 rounded-full text-theme-text-primary text-xs transition-colors whitespace-nowrap"
                          >
                            Danni & Penali
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {bookings.filter(booking => {
                  // Search filter
                  if (!bookingSearchQuery) return true
                  const words = bookingSearchQuery.toLowerCase().split(/\s+/).filter(Boolean)
                  const customerName = (booking.booking_details?.customer?.fullName || booking.customer_name || '').toLowerCase()
                  const customerEmail = (booking.customer_email || booking.booking_details?.customer?.email || '').toLowerCase()
                  const customerPhone = (booking.customer_phone || booking.booking_details?.customer?.phone || '').toLowerCase()
                  const vehicleName = (booking.vehicle_name || '').toLowerCase()
                  const vehiclePlate = (booking.vehicle_plate || '').toLowerCase()
                  const bookingId = String(booking.id || '').toLowerCase()
                  const bookingCode = bookingId.substring(0, 8)
                  const norm = (s: string) => s.replace(/[\s\-\+\(\)]/g, '')
                  const normalisedWords = words.map(norm)
                  const searchText = norm(`${customerName} ${customerEmail} ${customerPhone} ${vehicleName} ${vehiclePlate} ${bookingId} ${bookingCode} dr7${bookingCode}`)
                  return normalisedWords.every(word => searchText.includes(word))
                }).length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-theme-text-muted">
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
          <div className="fixed inset-0 bg-theme-bg-primary backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="w-full sm:max-w-2xl bg-theme-bg-secondary sm:rounded-lg max-h-[90vh] flex flex-col overflow-hidden border border-theme-border/30">
              {/* Modal Header */}
              <div className="flex-shrink-0  p-4 border-b border-theme-border flex justify-between items-center">
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-dr7-gold">Dettagli Prenotazione</h3>
                  <p className="text-xs text-theme-text-muted mt-0.5 font-mono tracking-wide">
                    Codice: DR7-{String(selectedBooking.id || '').substring(0, 8).toUpperCase()}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedBooking(null)}
                  className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none min-w-[44px] min-h-[44px] flex items-center justify-center"
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
                        <span className="text-theme-text-muted">Telefono:</span> <span className="text-theme-text-primary">{selectedBooking.customer_phone || selectedBooking.booking_details?.customer?.phone || '-'}</span>
                      </div>
                      {(selectedBooking.customer_phone || selectedBooking.booking_details?.customer?.phone) && (
                        <a
                          href={`tel:${selectedBooking.customer_phone || selectedBooking.booking_details?.customer?.phone}`}
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
                        <div><span className="text-theme-text-muted">Assicurazione:</span> <span className="text-dr7-gold">{({'RCA':'RCA Compresa (no Kasko)','KASKO':'Kasko Base','KASKO_BASE':'Kasko Base','KASKO_BLACK':'Kasko Black','KASKO_SIGNATURE':'Kasko Signature','DR7':'Kasko DR7'} as Record<string,string>)[selectedBooking.booking_details?.insuranceOption || ''] || selectedBooking.booking_details?.insuranceOption || 'Kasko Base'}</span></div>
                        <div><span className="text-theme-text-muted">Cauzione:</span> <span className="text-theme-text-primary">{
                          selectedBooking.booking_details?.depositOption === 'no_deposit'
                            ? `Senza cauzione (+30% = €${selectedBooking.booking_details?.noDepositSurcharge?.toFixed(2) || '0.00'})`
                            : (selectedBooking.deposit_amount || selectedBooking.booking_details?.deposit)
                              ? `€${selectedBooking.deposit_amount || selectedBooking.booking_details?.deposit}`
                              : 'N/A'
                        }</span></div>
                        <div><span className="text-theme-text-muted">KM:</span> <span className="text-theme-text-primary">{(() => {
                          const bd = selectedBooking.booking_details;
                          if (bd?.unlimited_km || bd?.km_limit === 'Illimitati') return 'KM Illimitati';
                          const perDayMatch = bd?.km_limit?.match?.(/^(\d+)\/giorno$/)
                          if (perDayMatch && selectedBooking.pickup_date && selectedBooking.dropoff_date) {
                            const kmPerDay = parseInt(perDayMatch[1])
                            const days = Math.ceil((new Date(selectedBooking.dropoff_date).getTime() - new Date(selectedBooking.pickup_date).getTime()) / (1000 * 60 * 60 * 24));
                            return `${kmPerDay * days} Km (${kmPerDay}/g x ${days}gg)`;
                          }
                          return bd?.km_limit ? `${bd.km_limit} km` : 'KM Illimitati';
                        })()}</span></div>
                        {(selectedBooking.delivery_enabled || selectedBooking.booking_details?.delivery_enabled) && (
                          <div className="mt-2 pt-2 border-t border-theme-border/30">
                            <span className="text-theme-text-muted">Consegna a domicilio:</span>
                            <span className="text-theme-text-primary ml-1">
                              {(() => { const addr = selectedBooking.delivery_address || selectedBooking.booking_details?.delivery_address; return addr ? `${addr.street}, ${addr.city}` : 'Si' })()}
                              {' '}(€{((selectedBooking.delivery_fee || 0) / 100).toFixed(2)})
                            </span>
                          </div>
                        )}
                        {(selectedBooking.pickup_enabled || selectedBooking.booking_details?.pickup_enabled) && (
                          <div>
                            <span className="text-theme-text-muted">Ritiro a domicilio:</span>
                            <span className="text-theme-text-primary ml-1">
                              {(() => { const addr = selectedBooking.pickup_address || selectedBooking.booking_details?.pickup_address; return addr ? `${addr.street}, ${addr.city}` : 'Si' })()}
                              {' '}(€{((selectedBooking.pickup_fee || 0) / 100).toFixed(2)})
                            </span>
                          </div>
                        )}
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
                        selectedBooking.payment_status === 'succeeded' ||
                        (selectedBooking.booking_details?.amountPaid && selectedBooking.booking_details.amountPaid >= selectedBooking.price_total)
                        ? 'bg-green-900 text-green-300'
                        : selectedBooking.payment_status === 'partial'
                          ? 'bg-amber-900 text-amber-300'
                          : (selectedBooking.payment_status === 'pending' || selectedBooking.payment_status === 'unpaid' || selectedBooking.status === 'pending')
                          ? 'bg-yellow-900 text-yellow-300'
                          : selectedBooking.payment_status === 'expired'
                            ? 'bg-orange-900 text-orange-300'
                            : 'bg-red-900 text-red-300'
                        }`}>
                        {selectedBooking.payment_status === 'completed' ||
                          selectedBooking.payment_status === 'paid' ||
                          selectedBooking.payment_status === 'succeeded' ||
                          (selectedBooking.booking_details?.amountPaid && selectedBooking.booking_details.amountPaid >= selectedBooking.price_total)
                          ? <>Pagato{selectedBooking.payment_method && <span className="ml-1 opacity-70">· {selectedBooking.payment_method}</span>}</>
                          : selectedBooking.payment_status === 'partial'
                            ? `Parziale €${((selectedBooking.amount_paid || 0) / 100).toFixed(0)}`
                          : (selectedBooking.payment_status === 'pending' || selectedBooking.payment_status === 'unpaid' || selectedBooking.status === 'pending')
                            ? 'Da Saldare'
                            : selectedBooking.payment_status === 'expired'
                              ? 'Scaduto'
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
                      onClick={() => selectedBooking.contract_url ? window.open(selectedBooking.contract_url, '_blank') : handleGenerateContract(selectedBooking)}
                      disabled={!selectedBooking.contract_url && generatingContract}
                      className="flex-1 px-4 py-3 bg-green-600/30 hover:bg-green-600/50 rounded-full text-theme-text-primary transition-colors font-medium disabled:opacity-50"
                    >
                      {!selectedBooking.contract_url && generatingContract ? 'Generazione in corso...' : selectedBooking.contract_url ? 'Scarica Contratto' : 'Genera Contratto'}
                    </button>
                  )}
                  {selectedBooking.contract_url && (
                    <button
                      onClick={() => handleResendContract(selectedBooking)}
                      className="flex-1 px-4 py-3 bg-orange-600/30 hover:bg-orange-600/50 rounded-full text-theme-text-primary transition-colors font-medium"
                    >
                      Invia Contratto
                    </button>
                  )}
                  {/* Pre-Auth Cauzione disabled — Nexi capture not reliable via API */}
                  {selectedBooking.status !== 'cancelled' && (
                    <button
                      onClick={() => {
                        handleDeleteBooking(selectedBooking.id, 'booking')
                        setSelectedBooking(null)
                      }}
                      className="flex-1 px-4 py-3 bg-red-600/30 hover:bg-red-600/50 rounded-full text-theme-text-primary rounded-full transition-colors font-medium"
                    >
                      Cancella Prenotazione
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedBooking(null)}
                    className="flex-1 px-4 py-3 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-full transition-colors font-medium"
                  >
                    Chiudi
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Missing Fields Modal - Shows only the missing fields */}
        {showMissingDataModal && tempCustomerData && (tempCustomerData.id || currentValidationBooking?.user_id) && (
          <MissingFieldsModal
            isOpen={showMissingDataModal}
            customerId={tempCustomerData.id || currentValidationBooking?.user_id}
            customerData={tempCustomerData}
            missingFields={missingFields}
            onClose={() => setShowMissingDataModal(false)}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onSave={async (updatedData: any) => {
              try {
                logger.log('[ReservationsTab] Missing fields saved:', updatedData)

                const resolvedCustomerId = updatedData.id

                // If in booking context, update form to use this customer
                if (validationContext === 'booking') {
                  logger.log('[ReservationsTab] Resuming booking with customer:', resolvedCustomerId)
                  setFormData(prev => ({ ...prev, customer_id: resolvedCustomerId }))
                  setNewCustomerMode(false)
                }

                // Reload data to refresh customer list
                await loadData()
                setShowMissingDataModal(false)

                // If in booking context, automatically continue with booking submission
                if (validationContext === 'booking') {
                  logger.log('[ReservationsTab] Auto-resuming booking submission...')
                  // Use setTimeout to ensure state updates have propagated
                  setTimeout(() => {
                    processBookingSubmission(true, resolvedCustomerId)
                  }, 100)
                }
                // If in contract/invoice context, retry generation
                else if (validationContext === 'contract' && currentValidationBooking) {
                  logger.log('[ReservationsTab] Retrying contract generation...')
                  setTimeout(() => {
                    handleGenerateContract(currentValidationBooking, true)
                  }, 100)
                } else if (validationContext === 'invoice' && currentValidationBooking) {
                  logger.log('[ReservationsTab] Retrying invoice generation...')
                  setTimeout(() => {
                    handleGenerateInvoice(currentValidationBooking)
                  }, 100)
                }
              } catch (error: unknown) {
                const _errMsg = error instanceof Error ? error.message : String(error)
                console.error('[ReservationsTab] Error after saving missing fields:', error)
                alert(`Errore: ${_errMsg}`)
              }
            }}
          />
        )}




        {/* ===== EXTEND BOOKING MODAL ===== */}
        {showExtendModal && extendingBooking && (
          <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setShowExtendModal(false)}>
            <div className="bg-theme-bg-secondary sm:rounded-lg p-4 sm:p-6 w-full sm:max-w-md max-h-[90vh] overflow-y-auto shadow-xl border border-theme-border/50" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-xl font-bold mb-4 text-purple-400">Estendi Prenotazione</h3>

              {/* Current Booking Info */}
              <div className="bg-theme-bg-secondary/50 rounded-lg p-3 mb-4">
                <div className="text-sm text-theme-text-muted">Cliente</div>
                <div className="text-theme-text-primary font-medium">{extendingBooking.customer_name || extendingBooking.booking_details?.customer?.fullName || 'N/A'}</div>
                <div className="text-sm text-theme-text-muted mt-2">Veicolo</div>
                <div className="text-theme-text-primary font-medium">{extendingBooking.vehicle_name || 'N/A'}</div>
                <div className="text-sm text-theme-text-muted mt-2">Riconsegna Attuale</div>
                <div className="text-theme-text-primary font-medium">
                  {new Date(extendingBooking.dropoff_date).toLocaleString('it-IT', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Europe/Rome'
                  })}
                </div>
              </div>

              {/* Extension Form */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Nuova Data Riconsegna</label>
                  <input
                    type="date"
                    value={extendData.new_return_date}
                    onChange={(e) => setExtendData({ ...extendData, new_return_date: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Nuovo Orario Riconsegna</label>
                  <select
                    value={extendData.new_return_time}
                    onChange={(e) => setExtendData({ ...extendData, new_return_time: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-purple-500"
                  >
                    {TIME_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Vehicle Change Toggle */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={extendData.change_vehicle}
                      onChange={(e) => setExtendData({ ...extendData, change_vehicle: e.target.checked, new_vehicle_id: '' })}
                      className="w-4 h-4 accent-purple-500"
                    />
                    <span className="text-sm font-medium text-theme-text-secondary">Cambio Veicolo</span>
                  </label>
                </div>

                {extendData.change_vehicle && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-theme-text-secondary">Nuovo Veicolo</label>
                      <button
                        type="button"
                        onClick={() => setExtendData({ ...extendData, show_all_vehicles: !extendData.show_all_vehicles })}
                        className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                      >
                        {extendData.show_all_vehicles ? 'Nascondi ritirati' : 'Mostra tutti i veicoli'}
                      </button>
                    </div>
                    <select
                      value={extendData.new_vehicle_id}
                      onChange={(e) => setExtendData({ ...extendData, new_vehicle_id: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-purple-500"
                    >
                      <option value="">-- Seleziona veicolo --</option>
                      {vehicles
                        .filter(v => (extendData.show_all_vehicles || v.status !== 'retired') && v.id !== extendingBooking?.vehicle_id)
                        .map(v => (
                          <option key={v.id} value={v.id}>{v.display_name} ({v.plate || v.targa || 'N/A'}){v.status === 'retired' ? ' [Ritirato]' : ''}</option>
                        ))
                      }
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Importo Aggiuntivo (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={extendData.additional_amount}
                    onChange={(e) => setExtendData({ ...extendData, additional_amount: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-purple-500"
                    placeholder="0.00"
                  />
                </div>

                {/* KM Extension */}
                <div className="bg-theme-bg-secondary/50 rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-theme-text-secondary">
                      Km attuali: <span className="text-theme-text-primary font-bold">
                        {extendingBooking.booking_details?.unlimited_km || extendingBooking.booking_details?.km_limit === 'Illimitati'
                          ? 'Illimitati'
                          : `${extendingBooking.booking_details?.km_limit || '0'} Km`}
                      </span>
                    </span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={extendData.extension_unlimited_km}
                      onChange={(e) => setExtendData({ ...extendData, extension_unlimited_km: e.target.checked, extension_km_added: '' })}
                      className="w-4 h-4 accent-purple-500"
                    />
                    <span className="text-sm font-medium text-theme-text-secondary">Km Illimitati</span>
                  </label>
                  {!extendData.extension_unlimited_km && (
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">Km da Aggiungere</label>
                      <input
                        type="number"
                        min="0"
                        step="10"
                        value={extendData.extension_km_added}
                        onChange={(e) => setExtendData({ ...extendData, extension_km_added: e.target.value })}
                        className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-purple-500"
                        placeholder="es. 100"
                      />
                      {extendData.extension_km_added && parseInt(extendData.extension_km_added) > 0 && (
                        <p className="text-xs text-purple-400 mt-1">
                          Nuovo totale: {parseInt(String(extendingBooking.booking_details?.km_limit || '0')) + parseInt(extendData.extension_km_added)} Km
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Stato Pagamento Estensione</label>
                  <select
                    value={extendData.extension_payment_status}
                    onChange={(e) => setExtendData({ ...extendData, extension_payment_status: e.target.value as 'paid' | 'pending' | 'nexi_pay_by_link' })}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-purple-500"
                  >
                    <option value="pending">Da Saldare</option>
                    <option value="nexi_pay_by_link">Nexi Pay by Link</option>
                    <option value="paid">Pagato</option>
                  </select>
                </div>

                {extendData.extension_payment_status === 'paid' && (
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Metodo Pagamento Estensione</label>
                    <select
                      value={extendData.extension_payment_method}
                      onChange={(e) => setExtendData({ ...extendData, extension_payment_method: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-purple-500"
                    >
                      <option value="">-- Seleziona --</option>
                      <option value="Bonifico">Bonifico</option>
                      <option value="Contanti">Contanti</option>
                      <option value="Carta di Credito / bancomat">Carta di Credito / bancomat</option>
                      <option value="Credit Wallet">Credit Wallet</option>
                      <option value="Paypal">Paypal</option>
                    </select>
                  </div>
                )}

                {extendData.extension_payment_status === 'nexi_pay_by_link' && (
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Validità Link</label>
                    <select
                      value={extendData.link_expiration_hours}
                      onChange={(e) => setExtendData({ ...extendData, link_expiration_hours: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-purple-500"
                    >
                      <option value="1">1 ora</option>
                      <option value="12">12 ore</option>
                      <option value="24">24 ore</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Note (opzionale)</label>
                  <textarea
                    value={extendData.notes}
                    onChange={(e) => setExtendData({ ...extendData, notes: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-purple-500 resize-none"
                    rows={2}
                    placeholder="Motivo estensione..."
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3 justify-end mt-6">
                <button
                  type="button"
                  onClick={() => { setShowExtendModal(false); setExtendingBooking(null); }}
                  className="flex-1 sm:flex-none px-4 py-3 min-h-[44px] bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg transition-colors"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={handleConfirmExtend}
                  disabled={isExtending || !extendData.new_return_date}
                  className="flex-1 sm:flex-none px-4 py-3 min-h-[44px] bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExtending ? 'Estensione...' : 'Conferma Estensione'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div >
    </>
  )
}


