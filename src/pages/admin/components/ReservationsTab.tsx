import { useState, useEffect, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import { getSpecialPricing, calculateSpecialPrice } from '../../../utils/specialPricing'
import { isWithinOfficeHoursForDate, getOfficeMinuteRangesForDate } from '../../../utils/noleggioHours'
import { supabase } from '../../../supabaseClient'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'
import { isNexiPayByLink } from '../../../utils/paymentMethodMatchers'
import { isTestBooking, isTestVehicle } from '../../../utils/isTestBooking'
import {
  prorateRevenueForMonth,
  isReportableRentalBooking,
  getOccupiedDaysInMonth,
  type MonthlyBookingLike,
} from '../../../utils/monthlyBookingMath'

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
  isVehicleAvailable,
  getRentalBufferMinutes,
  getPrePickupCarwashBufferMinutes
} from '../../../utils/vehicleAvailability'
import Input from './Input'
import Select from './Select'
import AddressAutocomplete from './AddressAutocomplete'
import Button from './Button'
import CustomerAutocomplete from './CustomerAutocomplete'
import NewClientModal from './NewClientModal'
import MissingFieldsModal from '../../../components/MissingFieldsModal'
import ClientStatusBadge from '../../../components/ClientStatusBadge'
import PenaltyModal from './PenaltyModal'
import DanniModal from './DanniModal'
import GestisciMenu, { type GestisciSection } from './GestisciMenu'
import DanniPenaliModal from './DanniPenaliModal'
import LimitationOverrideModal from '../../../components/LimitationOverrideModal'
import { useLimitationOverride } from '../../../hooks/useLimitationOverride'
import { isOtpRequired } from '../../../utils/otpConfigCache'
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
import { getKmIncluded, getUnlimitedKmPrice as getUnlimitedKmPriceFromConfig, getInsuranceOptions as getInsuranceOptionsFromConfig, getInsuranceNameById } from '../../../utils/configLookup'
import { resolvePacchetti } from '../../../utils/pacchettiResolver'
import { paymentMethodAutoInvoice } from '../../../utils/paymentMethodAutoInvoice'

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

// Rental schedule comes from Centralina Pro > Orari Noleggio
// (utils/noleggioHours). Admin can still pick any slot — flagged ones
// just get a loud label + red styling so the choice is deliberate.
function isInRentalHours(dateStr: string | undefined, time: string, kind: 'pickup' | 'return'): boolean {
  if (!dateStr) return true // unknown date → don't flag
  return isWithinOfficeHoursForDate(dateStr, time, kind)
}

// Rental hour ranges for a date as [[startMin, endMin], ...].
// Returns null when the day is CLOSED (Sunday / configured closure) so
// callers can display "Domenica chiusa" without distinguishing
// undefined-vs-empty-array. Wraps getOfficeMinuteRangesForDate.
function rentalHoursFor(dateStr: string | undefined, kind: 'pickup' | 'return'): [number, number][] | null {
  if (!dateStr) return null
  const ranges = getOfficeMinuteRangesForDate(dateStr, kind)
  return ranges.length === 0 ? null : ranges
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
// BUG FIX 2026-05-13: alias supercars <-> exotic (la config puo' usare
// una delle due chiavi a seconda di quando e' stata creata). Senza alias
// il lookup falliva e cadeva su _global, mostrando "€0/km" nel form.
// Inoltre i valori 0 / '0' vengono trattati come "non configurato" → ''
// per evitare di pubblicare "Default Centralina: €0/km" quando in realta'
// l'admin non ha settato uno sforo per quella categoria.
function getSforoForCategory(
  vehicle: Vehicle | undefined,
  rentalConfig: import('../../../types/rentalConfig').RentalConfig | null,
): string {
  if (!rentalConfig?.sforo_km) return ''
  const cat = vehicle?.category as string | undefined
  if (cat) {
    const aliases = cat === 'supercars' ? ['supercars', 'exotic']
                  : cat === 'exotic' ? ['exotic', 'supercars']
                  : [cat]
    for (const key of aliases) {
      const catSforo = rentalConfig.sforo_km.category?.[key]
      if (catSforo != null && Number(catSforo) > 0) return String(catSforo)
    }
  }
  const g = rentalConfig.sforo_km._global
  if (g != null && Number(g) > 0) return String(g)
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

// Builds a human-readable diff by comparing the snapshot of formData
// captured when the booking was opened for edit against the live
// formData at Salva time. Snapshot-vs-current diffing avoids false
// positives caused by booking_details key mismatches (camelCase vs
// snake_case, multi-shape deposit fields, etc.) and only surfaces
// fields the operator actually changed.
function buildBookingEditDiff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  before: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  after: Record<string, any>,
  customerName: string,
  bookingId: string,
  vehicles: Vehicle[],
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []

  const fmtFormDateTime = (date: string, time: string) => {
    if (!date) return '—'
    const [y, m, d] = date.split('-')
    if (!y || !m || !d) return `${date} ${time || ''}`
    return `${d}/${m}/${y}, ${time || '00:00'}`
  }

  const eur = (n: unknown) => {
    const num = typeof n === 'number' ? n : parseFloat(String(n ?? 0))
    if (!Number.isFinite(num)) return '—'
    return `€${num.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const numEq = (a: unknown, b: unknown) => {
    const na = parseFloat(String(a ?? 0))
    const nb = parseFloat(String(b ?? 0))
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a ?? '') === String(b ?? '')
    return Math.abs(na - nb) < 0.005
  }

  const strEq = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')
  const vehName = (id: unknown) => vehicles.find(v => v.id === id)?.display_name || '—'

  rows.push({ label: 'Cliente', value: customerName || '—' })
  rows.push({ label: 'Prenotazione', value: bookingId.slice(0, 8) })

  if (!strEq(before.vehicle_id, after.vehicle_id)) {
    rows.push({ label: 'Veicolo', value: `${vehName(before.vehicle_id)} → ${vehName(after.vehicle_id)}` })
  }

  if (!strEq(before.pickup_date, after.pickup_date) || !strEq(before.pickup_time, after.pickup_time)) {
    rows.push({
      label: 'Ritiro',
      value: `${fmtFormDateTime(before.pickup_date, before.pickup_time)} → ${fmtFormDateTime(after.pickup_date, after.pickup_time)}`,
    })
  }

  if (!strEq(before.return_date, after.return_date) || !strEq(before.return_time, after.return_time)) {
    rows.push({
      label: 'Riconsegna',
      value: `${fmtFormDateTime(before.return_date, before.return_time)} → ${fmtFormDateTime(after.return_date, after.return_time)}`,
    })
  }

  if (!strEq(before.pickup_location, after.pickup_location)) {
    rows.push({ label: 'Luogo ritiro', value: `${before.pickup_location || '—'} → ${after.pickup_location || '—'}` })
  }
  if (!strEq(before.dropoff_location, after.dropoff_location)) {
    rows.push({ label: 'Luogo riconsegna', value: `${before.dropoff_location || '—'} → ${after.dropoff_location || '—'}` })
  }

  if (!numEq(before.total_amount, after.total_amount)) {
    rows.push({ label: 'Importo totale', value: `${eur(before.total_amount)} → ${eur(after.total_amount)}` })
  }
  if (!numEq(before.amount_paid, after.amount_paid)) {
    rows.push({ label: 'Importo pagato', value: `${eur(before.amount_paid)} → ${eur(after.amount_paid)}` })
  }

  if (!strEq(before.status, after.status)) {
    rows.push({ label: 'Stato', value: `${before.status || '—'} → ${after.status || '—'}` })
  }
  if (!strEq(before.payment_status, after.payment_status)) {
    rows.push({ label: 'Pagamento', value: `${before.payment_status || '—'} → ${after.payment_status || '—'}` })
  }
  if (!strEq(before.payment_method, after.payment_method)) {
    rows.push({ label: 'Metodo pagamento', value: `${before.payment_method || '—'} → ${after.payment_method || '—'}` })
  }
  if (!strEq(before.insurance_option, after.insurance_option)) {
    rows.push({ label: 'Assicurazione', value: `${before.insurance_option || '—'} → ${after.insurance_option || '—'}` })
  }
  if (!numEq(before.deposit, after.deposit)) {
    rows.push({ label: 'Cauzione', value: `${eur(before.deposit)} → ${eur(after.deposit)}` })
  }
  if (!strEq(before.deposit_status, after.deposit_status)) {
    rows.push({ label: 'Stato cauzione', value: `${before.deposit_status || '—'} → ${after.deposit_status || '—'}` })
  }

  if (rows.length <= 2) {
    rows.push({ label: 'Modifica', value: 'Nessuna variazione rilevata sui campi principali' })
  }

  return rows
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ReservationsTab({ initialData, onDataConsumed }: { initialData?: { vehicleId?: string; pickupDate?: Date; bookingId?: string; fromPreventivo?: Record<string, any> } | null; onDataConsumed?: () => void }) {
  const { canViewFinancials } = useAdminRole()
  const paymentMethods = usePaymentMethods()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [carWashBookings, setCarWashBookings] = useState<Booking[]>([]) // Car wash & mechanical bookings for availability checking

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
    markCodesApproved,
    closeLimitation,
    cancelLimitation,
    hasOverride,
    consumeAllOverrides,
    activeOverrides,
    overrideCodes,
    draftSessionId,
    flowType,
    newSession,
    getOverrideAuditSnapshot,
  } = useLimitationOverride()

  // Buffer for a Salva click on a paid/confirmed booking that's been
  // blocked by the OTP gate. When direzione approves the OTP, the
  // useEffect below replays processBookingSubmission with the same args,
  // so the operator doesn't have to re-click Salva.
  const pendingSubmitRef = useRef<{ skipValidation: boolean; overrideCustomerId?: string } | null>(null)
  // Codici di limitation aggiuntivi da marcare come autorizzati con lo stesso
  // overrideId della modal corrente. Usato per il flusso "motivazioni
  // combinate": la modal verifica una sola OTP, poi marchiamo anche gli altri
  // gate scattati così il resume non chiede una seconda autorizzazione.
  const comboExtraCodesRef = useRef<string[]>([])
  const comboMessageRef = useRef<string>('')

  // Snapshot of formData captured when the operator opens an existing
  // booking for edit. Diffed against live formData at Salva time so the
  // OTP email shows only what the operator actually changed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editFormSnapshotRef = useRef<Record<string, any> | null>(null)

  // 2026-05-18: quando l'admin scrive a mano nel campo "Importo Totale (€)",
  // questo flag diventa true e i recalc effects NON sovrascrivono piu' il
  // total_amount. Cosi' l'admin puo' decidere il prezzo finale a piacere
  // dopo aver aggiunto pacchetti / consegna / ritiro / etc. Si resetta
  // quando: apre nuova booking, cambia veicolo, cambia date, oppure
  // chiude/resetta il form.
  const totalAmountManuallyOverriddenRef = useRef<boolean>(false)
  // Forza re-render quando il flag cambia (per mostrare/nascondere il banner).
  const [, setTotalLockTick] = useState(0)
  const setTotalLock = (v: boolean) => {
    if (totalAmountManuallyOverriddenRef.current !== v) {
      totalAmountManuallyOverriddenRef.current = v
      setTotalLockTick(t => t + 1)
    }
  }

  // Override details state — accetta sia legacy array (compat) sia
  // strutturato { gate, customer, operation, meta } (preferito).
  // Server-side limitation-override-otp.ts gestisce entrambe le forme;
  // il payload strutturato attiva il rendering sezionato e colorato
  // nell'email a direzione.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [overrideDetails, setOverrideDetails] = useState<any>(undefined)

  // Helper: costruisce il payload "Dettaglio richiesta" che finisce nella
  // mail OTP a direzione, in forma STRUTTURATA (gate/customer/operation/meta).
  // Legge lo stato corrente (formData, customers, vehicles, customerTier,
  // modalita' nuovo cliente) e include solo i campi con valore. Gli `extras`
  // del caller vanno tutti in `gate` (sono motivi/condizioni che hanno
  // attivato l'OTP — meritano la sezione rossa in cima all'email).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  function buildOverrideDetailsBase(extras: Array<{ label: string; value: string }> = []): Record<string, unknown> {
    const gate: Record<string, string> = {}
    const customerSec: Record<string, string> = {}
    const operation: Record<string, string> = {}
    const meta: Record<string, string> = {}

    const set = (dst: Record<string, string>, label: string, value: string | number | null | undefined) => {
      if (value === null || value === undefined) return
      const s = String(value).trim()
      if (!s || s === '—') return
      dst[label] = s
    }
    const eur = (n: unknown) => {
      const num = typeof n === 'number' ? n : parseFloat(String(n ?? 0))
      return Number.isFinite(num) && num > 0
        ? `€${num.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : ''
    }
    const fmtDate = (d: string, t: string) => {
      if (!d) return ''
      const [y, mo, da] = d.split('-')
      return y && mo && da ? `${da}/${mo}/${y}${t ? ` ${t}` : ''}` : `${d}${t ? ` ${t}` : ''}`
    }

    // Operazione
    set(operation, 'Tipo operazione', editingId ? 'Modifica prenotazione noleggio' : 'Nuova prenotazione noleggio')
    if (editingId) set(operation, 'Riferimento', `DR7-${editingId.slice(0, 8).toUpperCase()}`)

    // Cliente
    const cust = customers.find(c => c.id === formData.customer_id)
    const newFullName = `${newCustomerData?.nome || ''} ${newCustomerData?.cognome || ''}`.trim()
    const customerName = newCustomerMode
      ? (newFullName || newCustomerData?.denominazione || '')
      : (cust?.full_name || '')
    const customerEmail = newCustomerMode ? (newCustomerData?.email || '') : (cust?.email || '')
    const customerPhone = newCustomerMode ? (newCustomerData?.telefono || '') : (cust?.phone || '')
    set(customerSec, 'Nome', customerName)
    set(customerSec, 'Email', customerEmail)
    set(customerSec, 'Telefono', customerPhone)

    // Fascia cliente (se classificata)
    if (customerTier) {
      const fasciaLabel = customerTier.tier === 'TIER_2' ? 'A'
        : customerTier.tier === 'TIER_1' ? 'B'
        : 'Bloccata'
      const ageLic = customerTier.reason ? ` — ${customerTier.reason}` : ''
      set(customerSec, 'Fascia cliente', `${fasciaLabel}${ageLic}`)
    }
    // Patente (se presente sul cliente selezionato)
    if (cust) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = cust as any
      const patNum = c.patente || c.numero_patente || c.metadata?.patente?.numero
      const patScad = c.scadenza_patente || c.data_scadenza_patente || c.metadata?.patente?.scadenza
      if (patNum) {
        const scadStr = patScad ? ` (scadenza ${new Date(patScad).toLocaleDateString('it-IT')})` : ''
        set(customerSec, 'Patente', `${patNum}${scadStr}`)
      }
    }

    // Veicolo + targa
    const veh = vehicles.find(v => v.id === formData.vehicle_id)
    if (veh) {
      set(operation, 'Veicolo', `${veh.display_name}${veh.plate ? ` (${veh.plate})` : ''}`)
    }
    // Date ritiro/riconsegna + giorni
    set(operation, 'Ritiro', fmtDate(formData.pickup_date, formData.pickup_time))
    set(operation, 'Riconsegna', fmtDate(formData.return_date, formData.return_time))
    if (formData.pickup_date && formData.pickup_time && formData.return_date && formData.return_time) {
      const p = new Date(`${formData.pickup_date}T${formData.pickup_time}:00`)
      const r = new Date(`${formData.return_date}T${formData.return_time}:00`)
      if (!isNaN(p.getTime()) && !isNaN(r.getTime()) && r > p) {
        const diffH = (r.getTime() - p.getTime()) / (1000 * 60 * 60)
        const days = Math.ceil(diffH / 24)
        set(operation, 'Giorni noleggio', String(days))
      }
    }
    // Luogo ritiro
    set(operation, 'Luogo ritiro', formData.pickup_location || '')
    // Importi
    const totEur = eur(formData.total_amount)
    if (totEur) set(operation, 'Importo totale', totEur)
    if (formData.deposit_status === 'no_cauzione') {
      set(operation, 'Cauzione', 'No Cauzione')
    } else {
      const depEur = eur(formData.deposit)
      if (depEur) set(operation, 'Cauzione richiesta', depEur)
    }
    set(operation, 'Metodo pagamento', formData.payment_method || '')
    set(operation, 'Stato pagamento', formData.payment_status || '')
    set(operation, 'Assicurazione', formData.insurance_option || '')

    // Meta — operatore + timestamp
    const operatorEmail = typeof window !== 'undefined' ? (sessionStorage.getItem('admin-email') || null) : null
    if (operatorEmail) set(meta, 'Operatore', operatorEmail)
    set(meta, 'Data richiesta', new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }))

    // Append extras come motivazioni in `gate` (sezione rossa
    // evidenziata — la direzione legge per prima il PERCHE' dell'OTP)
    // Append extras
    for (const e of extras) {
      if (e && e.label && e.value) set(gate, e.label, e.value)
    }
    return { gate, customer: customerSec, operation, meta }
  }

  // 2026-05-18: AUTO-RESUME del save dopo approvazione OTP.
  // Se un gate ha messo pendingSubmitRef e poi e' arrivato l'approve
  // (overrideCodes contiene almeno un nuovo codice), ri-firiamo subito
  // processBookingSubmission — niente piu' "infinity loop" dove l'admin
  // dopo OK alla modale doveva ri-cliccare Salva.
  // I codici extra del combo vengono marchiati in markCodesApproved
  // dentro onOverrideApproved.
  // Safety guards:
  //  - showForm: solo se il form e' aperto (no resume su form chiuso)
  //  - !submitLockRef.current: evita doppio submit se gia' in corso
  //  - overrideCodes.size > 0: deve esserci almeno una approvazione
  useEffect(() => {
    const pending = pendingSubmitRef.current
    if (!pending) return
    if (overrideCodes.size === 0) return
    if (!showForm) return
    if (submitLockRef.current || isSubmitting) return
    pendingSubmitRef.current = null
    processBookingSubmission(pending.skipValidation, pending.overrideCustomerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideCodes, showForm])

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
    // 2026-05-16: pacchetto KM extra (legacy single-select, mantenuti per
    // compat con vecchio codice). I nuovi flussi usano km_packages sotto.
    km_package_id: '' as string,
    km_package_qty: 1 as number,
    // 2026-05-16 multi-select cumulativo: Map pkgId → qty. Quando
    // >= 1 entry > 0, i pacchetti si SOMMANO. Esclusivo con unlimited_km.
    km_packages: {} as Record<string, number>,
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
  // Flags da Centralina Pro > Automazioni > Inclusione Coefficiente.
  // Per ogni extra: ON = entra nel subtotale clamp-eligible (× coefficiente),
  // OFF = venduto a listino e sommato dopo (come experience / location fees).
  // Default: KM Illimitati escluso, tutti gli altri inclusi (storico).
  type ProAutomations = {
    coefficient_unlimited_km?: boolean
    coefficient_insurance?: boolean
    coefficient_lavaggio?: boolean
    coefficient_no_cauzione?: boolean
    coefficient_second_driver?: boolean
    coefficient_dr7_flex?: boolean
    coefficient_cauzione_veicoli?: boolean
  }
  type CoeffFlags = {
    unlimited_km: boolean
    insurance: boolean
    lavaggio: boolean
    no_cauzione: boolean
    second_driver: boolean
    dr7_flex: boolean
    cauzione_veicoli: boolean
  }
  const buildCoeffFlags = (a: ProAutomations | undefined): CoeffFlags => ({
    unlimited_km:     !!a?.coefficient_unlimited_km,
    insurance:        a?.coefficient_insurance !== false,
    lavaggio:         a?.coefficient_lavaggio !== false,
    no_cauzione:      a?.coefficient_no_cauzione !== false,
    second_driver:    a?.coefficient_second_driver !== false,
    dr7_flex:         a?.coefficient_dr7_flex !== false,
    cauzione_veicoli: a?.coefficient_cauzione_veicoli !== false,
  })
  const [coeffFlags, setCoeffFlags] = useState<CoeffFlags>(buildCoeffFlags(undefined))
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      if (cancelled) return
      const cfg = (data?.config as { deposits?: Record<string, unknown>; automations?: ProAutomations } | undefined) || {}
      setProDeposits(cfg.deposits || null)
      setCoeffFlags(buildCoeffFlags(cfg.automations))
    })()
    const channel = supabase
      .channel('reservations-deposits')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' }, (payload) => {
        const cfg = (payload.new as { config?: { deposits?: Record<string, unknown>; automations?: ProAutomations } } | undefined)?.config
        if (cfg && typeof cfg === 'object') {
          setProDeposits(cfg.deposits || null)
          setCoeffFlags(buildCoeffFlags(cfg.automations))
        }
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

    const fasciaKey = customerTier?.tier === 'TIER_1' ? 'B' : 'A'
    const residencyKey = isResidenteSardegna ? 'residente' : 'non_residente'

    // 2026-05-15: filtra opzioni con is_active === false (toggle ON/OFF
    // Centralina Pro). Default true per backwards compat.
    const filterActive = (opts: ProDepositOption[]): ProDepositOption[] =>
      opts.filter(o => (o as { is_active?: boolean }).is_active !== false)

    if (isOld) {
      const fasciaCfg = (proDeposits[fasciaKey] as { residente?: unknown; non_residente?: unknown } | undefined)
      return filterActive((fasciaCfg?.[residencyKey] as ProDepositOption[]) || [])
    }

    // BUG FIX 2026-05-15: usa la categoria REALE del veicolo (qualunque id
    // l'admin abbia definito in Centralina Pro), con alias storici per
    // 'exotic' ↔ 'supercars'. Prima il codice flatava ogni veicolo in uno
    // dei 3 id legacy ('supercars'/'aziendali'/'urban') — quindi tutte le
    // categorie custom (Suv Luxury, Flotta Aziendale, Hypercar, ecc.)
    // venivano forzate a 'urban' e mostravano le opzioni cauzione sbagliate.
    const aliases: string[] = vehCat === 'supercars' ? ['supercars', 'exotic']
      : vehCat === 'exotic' ? ['exotic', 'supercars']
      : vehCat ? [vehCat] : []
    let catCfg: Record<string, { residente?: unknown; non_residente?: unknown }> | undefined
    for (const key of aliases) {
      const candidate = proDeposits[key] as Record<string, { residente?: unknown; non_residente?: unknown }> | undefined
      if (candidate) { catCfg = candidate; break }
    }
    const fasciaCfg = catCfg?.[fasciaKey]
    const ownOpts = filterActive(((fasciaCfg?.[residencyKey] as ProDepositOption[]) || []).slice())

    // BUG FIX 2026-05-15: niente piu' auto-borrow di "Nessuna cauzione" da
    // altre categorie. Prima, se questa categoria non aveva no_cauzione, il
    // codice ne prendeva una da un'altra categoria — quindi anche categorie
    // dove l'admin NON voleva mostrare l'opzione no_cauzione finivano per
    // mostrarla con il prezzo di un'altra categoria. Ora ogni categoria
    // mostra SOLO le opzioni che l'admin ha configurato per essa.
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
              // Stesso comportamento di PreventiviTab: il fee tipato
              // dall'admin entra SEMPRE nel totale (niente gate su
              // delivery_enabled / pickup_location). Se vale 0 non
              // influisce; se vale > 0 e' perche' admin l'ha messo,
              // quindi va contato.
              const deliveryFees = (parseFloat(prev.delivery_fee || '0') || 0)
                + (parseFloat(prev.pickup_fee || '0') || 0)
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
              const kmPackagesCost = (() => {
                const kmPkgs = (prev.km_packages || {}) as Record<string, number>
                if (!kmPkgs || Object.keys(kmPkgs).length === 0) return 0
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const pkgsByCat = (rentalConfig as any)?.pacchetti_km as Record<string, Array<{ id: string; price: number }>> | undefined
                const catPkgs = resolvePacchetti(selectedVehicle?.category, pkgsByCat)
                if (catPkgs.length === 0) return 0
                let sum = 0
                for (const pkg of catPkgs) {
                  const q = Number(kmPkgs[pkg.id]) || 0
                  if (q > 0) sum += Number(pkg.price || 0) * q
                }
                return Math.round(sum * 100) / 100
              })()
              // List price: base rate (no coefficients) × days + all services.
              // Experience services are EXCLUDED from the clamp — the Max €/g
              // from Centralina applies to rental + standard extras only; any
              // bespoke experience add-on is added on top afterwards.
              const listDailyRate = data.selectedBaseRateEur || getDailyRateFromConfig(selectedVehicle, data.rentalDays)
              const listRentalTotal = listDailyRate * data.rentalDays
              // Location fees (consegna + ritiro) are EXCLUDED from the
              // coefficient — same treatment as Experience. They cover
              // transport/km that doesn't scale with demand.
              // Per ogni extra, Automazioni > Inclusione Coefficiente decide se
              // entra nel subtotale clamp-eligible (× coefficiente) o se viene
              // sommato a listino dopo (come experience / location fees).
              const splitX = (amt: number, on: boolean) => on ? { inC: amt, at: 0 } : { inC: 0, at: amt }
              const sIns = splitX(insuranceTotal,         coeffFlags.insurance)
              const sLav = splitX(CFG_LAVAGGIO_FEE,       coeffFlags.lavaggio)
              // 2026-05-18: No Cauzione passa SEMPRE a listino (vedi PreventiviTab).
              // Era dentro extrasInCoeff e veniva mangiato dal max clamp / scalato
              // dal coefficiente → l'admin aggiungeva "No Cauzione" e il totale
              // cresceva di pochi euro invece dei €49 × giorni attesi.
              const sNoC = { inC: 0, at: noCauzioneSurcharge }
              const sKm  = splitX(unlimitedKmSurcharge,   coeffFlags.unlimited_km)
              const sSec = splitX(secondDriverFee,        coeffFlags.second_driver)
              const sFlx = splitX(flexCost,               coeffFlags.dr7_flex)
              const extrasInCoeff = sIns.inC + sLav.inC + sNoC.inC + sKm.inC + sSec.inC + sFlx.inC
              const extrasAtList  = sIns.at  + sLav.at  + sNoC.at  + sKm.at  + sSec.at  + sFlx.at
              const listSubtotalNoExp = listRentalTotal + extrasInCoeff
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
              // Experience + location fees + extras-at-list + pacchetti KM stay at LIST PRICE — no coefficient, no clamp.
              const subtotal = Math.round((afterRevenueNoExp + experienceCost + deliveryFees + extrasAtList + kmPackagesCost) * 100) / 100
              const total = prev.payment_method === 'Contanti' ? subtotal * 1.20 : subtotal
              // Auto-calculate KM limit from rental days (only if not unlimited)
              // 2026-05-18: salta total_amount se l'admin l'ha gia' modificato a mano.
              const updates: Record<string, string> = {}
              if (!totalAmountManuallyOverriddenRef.current) {
                updates.total_amount = total.toFixed(2)
              }
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
    // rentalConfig incluso nei deps: quando l'admin modifica Km / Sforo in
    // Centralina Pro la realtime sub di useRentalConfig aggiorna il valore;
    // senza qui dentro, il form continuava a usare il vecchio kmIncluded /
    // sforo finché l'operatore non cambiava manualmente veicolo o data.
  }, [formData.vehicle_id, formData.pickup_date, formData.return_date, formData.pickup_time, formData.return_time, customerTier, noCauzioneResolvedDaily, rentalConfig])

  // Track previous deposit values to detect user-initiated changes in edit mode.
  // Senza questo, il useEffect sotto non saprebbe distinguere "admin ha appena
  // selezionato No Cauzione" (deve ricalcolare il totale) da "form appena
  // caricato dalla prenotazione esistente" (deve preservare il prezzo concordato).
  const prevDepositRef = useRef<{ status: string; option_id: string } | null>(null)

  // Recalculate total when insurance, delivery fees, or payment method change.
  // Runs in any engine mode — the dynamic coefficient + clamp must always
  // apply to the full subtotal (rental + extras), matching Preventivi.
  //
  // In edit mode (editingId set): per default skip — la prenotazione esiste
  // gia' con un prezzo concordato. ECCEZIONE: se admin ha cambiato Opzione
  // Cauzione / Stato Cauzione, ricalcola il totale (la No Cauzione e' un
  // supplemento fisso che DEVE apparire nel totale, vedi richiesta utente
  // 2026-05-18). Date/ora/altri campi rimangono bloccati come prima.
  useEffect(() => {
    if (editingId) {
      const prev = prevDepositRef.current
      const depositChanged = prev !== null
        && (prev.status !== formData.deposit_status || prev.option_id !== formData.deposit_option_id)
      prevDepositRef.current = { status: formData.deposit_status, option_id: formData.deposit_option_id }
      if (!depositChanged) return
    } else {
      prevDepositRef.current = { status: formData.deposit_status, option_id: formData.deposit_option_id }
    }
    if (revenueSuggestion && formData.vehicle_id) {
      const selectedVehicle = vehicles.find(v => v.id === formData.vehicle_id)
      const activeTier = customerTier?.tier || 'TIER_1'
      const kaskoOptions = selectedVehicle ? getInsuranceOptions(selectedVehicle, activeTier, configOverlay, rentalConfig) : []
      const selectedKasko = kaskoOptions.find(k => k.id === formData.insurance_option)
      const insuranceTotal = (selectedKasko?.pricePerDay || 0) * revenueSuggestion.rentalDays
      // Stesso comportamento di PreventiviTab — il fee viene contato
      // ogni volta che ha un valore > 0, senza dipendere da checkbox
      // o dal valore del dropdown pickup_location. Admin ha digitato
      // il fee → admin vuole che sia nel totale.
      const deliveryFees = (parseFloat(formData.delivery_fee || '0') || 0)
        + (parseFloat(formData.pickup_fee || '0') || 0)
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
      const kmPackagesCost = (() => {
        const kmPkgs = (formData.km_packages || {}) as Record<string, number>
        if (!kmPkgs || Object.keys(kmPkgs).length === 0) return 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pkgsByCat = (rentalConfig as any)?.pacchetti_km as Record<string, Array<{ id: string; price: number }>> | undefined
        const catPkgs = resolvePacchetti(selectedVehicle?.category, pkgsByCat)
        if (catPkgs.length === 0) return 0
        let sum = 0
        for (const pkg of catPkgs) {
          const q = Number(kmPkgs[pkg.id]) || 0
          if (q > 0) sum += Number(pkg.price || 0) * q
        }
        return Math.round(sum * 100) / 100
      })()
      // List price: base rate (no coefficients) × days + all services.
      // Experience excluded from the clamp — same rationale as the
      // auto_apply branch above.
      const listDailyRate = revenueSuggestion.selectedBaseRateEur || getDailyRateFromConfig(selectedVehicle, revenueSuggestion.rentalDays)
      const listRentalTotal = listDailyRate * revenueSuggestion.rentalDays
      // Location fees (consegna + ritiro) excluded from the coefficient —
      // same rationale as Experience.
      const splitX = (amt: number, on: boolean) => on ? { inC: amt, at: 0 } : { inC: 0, at: amt }
      const sIns = splitX(insuranceTotal,         coeffFlags.insurance)
      const sLav = splitX(CFG_LAVAGGIO_FEE,       coeffFlags.lavaggio)
      // 2026-05-18: No Cauzione SEMPRE a listino — coerente con auto_apply.
      const sNoC = { inC: 0, at: noCauzioneSurcharge }
      const sKm  = splitX(unlimitedKmSurcharge,   coeffFlags.unlimited_km)
      const sSec = splitX(secondDriverFee,        coeffFlags.second_driver)
      const sFlx = splitX(flexCost,               coeffFlags.dr7_flex)
      const extrasInCoeff = sIns.inC + sLav.inC + sNoC.inC + sKm.inC + sSec.inC + sFlx.inC
      const extrasAtList  = sIns.at  + sLav.at  + sNoC.at  + sKm.at  + sSec.at  + sFlx.at
      const listSubtotalNoExp = listRentalTotal + extrasInCoeff
      const combinedCoeff = (revenueSuggestion.breakdown || []).reduce((acc: number, b: { coeff: number }) => acc * b.coeff, 1)
      const minDaily = typeof revenueSuggestion.minPrice === 'number' ? revenueSuggestion.minPrice : null
      const maxDaily = typeof revenueSuggestion.maxPrice === 'number' ? revenueSuggestion.maxPrice : null
      const maxTotal = maxDaily != null ? maxDaily * revenueSuggestion.rentalDays : null
      const minTotal = minDaily != null ? minDaily * revenueSuggestion.rentalDays : null
      let afterRevenueNoExp = listSubtotalNoExp * combinedCoeff
      if (maxTotal != null && afterRevenueNoExp > maxTotal) afterRevenueNoExp = maxTotal
      if (minTotal != null && afterRevenueNoExp < minTotal) afterRevenueNoExp = minTotal
      // Experience + location fees + extras-at-list + pacchetti KM stay at LIST PRICE — no coefficient, no clamp.
      const subtotal = Math.round((afterRevenueNoExp + experienceCost + deliveryFees + extrasAtList + kmPackagesCost) * 100) / 100
      const newTotal = formData.payment_method === 'Contanti' ? subtotal * 1.20 : subtotal
      // 2026-05-18: salta total_amount se l'admin l'ha gia' modificato a mano.
      const updates: Record<string, string> = {}
      if (!totalAmountManuallyOverriddenRef.current) {
        updates.total_amount = newTotal.toFixed(2)
      }
      // Auto-calculate KM limit = base (da rental days) + km dei pacchetti
      // KM selezionati × quantita'. Admin vuole vedere subito il limite totale
      // gia' sommato, senza doverlo digitare a mano.
      if (!formData.unlimited_km) {
        const vehCategory = selectedVehicle?.category || ''
        const kmCat = vehCategory === 'urban' ? 'urban' : (vehCategory || '_global')
        const kmIncluded = getKmIncluded(rentalConfig, revenueSuggestion.rentalDays, kmCat)
        if (kmIncluded !== 'unlimited') {
          // Somma i km dei pacchetti KM extra (id → quantita').
          const kmPkgs = (formData.km_packages || {}) as Record<string, number>
          let kmFromPackages = 0
          if (kmPkgs && Object.keys(kmPkgs).length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pkgsByCat = (rentalConfig as any)?.pacchetti_km as Record<string, Array<{ id: string; km: number }>> | undefined
            const catPkgs = resolvePacchetti(selectedVehicle?.category, pkgsByCat)
            for (const pkg of catPkgs) {
              const q = Number(kmPkgs[pkg.id]) || 0
              if (q > 0) kmFromPackages += Number(pkg.km || 0) * q
            }
          }
          const totalKm = Number(kmIncluded) + kmFromPackages
          updates.km_limit = String(totalKm)
        }
      }
      if (Object.keys(updates).length > 0) setFormData(prev => ({ ...prev, ...updates }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.insurance_option, formData.delivery_fee, formData.pickup_fee, formData.delivery_enabled, formData.pickup_enabled, formData.payment_method, formData.unlimited_km, formData.deposit_status, formData.deposit_option_id, formData.has_second_driver, formData.experience_services, formData.dr7_flex, formData.km_packages, customerTier, noCauzioneResolvedDaily, selectedDepositSurchargePerDay, rentalConfig])

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
      // BUG FIX 2026-05-15: popola SUBITO i dati del veicolo cosi'
      // l'admin vede brand/model/year senza dover cliccare Cerca due
      // volte. La OTP per anno < 2020 viene richiesta dopo, ma il
      // veicolo e' gia' visualizzato.
      //
      // BUG FIX 2026-05-15 (2): estrai l'anno con regex (gestisce
      // "2022", "2022-01-15", "01/2022", ecc. — OpenAPI a volte ritorna
      // formati diversi). Se proprio non c'e' anno, segna 'N/D' invece
      // di stringa vuota cosi' la validation al save NON ti rimanda a
      // Cerca in loop. Il gate OTP gestisce comunque il caso "anno
      // sconosciuto" come pre-2020 (richiede approvazione).
      const yearRaw = String(data.year || '').trim()
      const yearMatch = yearRaw.match(/(19|20)\d{2}/)
      const yearForForm = yearMatch ? yearMatch[0] : (yearRaw || 'N/D')
      // BUG FIX 2026-05-15 (3): se OpenAPI non ritorna brand/model
      // (succede su alcune targhe), usa 'N/D' invece di stringa vuota,
      // altrimenti la validation al save vede brand vuoto → "Clicca
      // Cerca" → loop infinito. La presenza di QUALSIASI valore (anche
      // 'N/D') segnala che la lookup è stata effettuata.
      const brandForForm = (data.brand && String(data.brand).trim()) || 'N/D'
      const modelForForm = (data.model && String(data.model).trim()) || ''
      setFormData(prev => ({
        ...prev,
        cauzione_targa_brand: brandForForm,
        cauzione_targa_model: modelForForm,
        cauzione_targa_year: yearForForm,
      }))
      toast.success(`${brandForForm} ${modelForForm} (${yearForForm}) trovato`)

      const year = yearMatch ? parseInt(yearMatch[0]) : NaN
      if (isNaN(year) || year < 2020) {
        if (!hasOverride('vehicle_year_too_old')) {
          setOverrideDetails(buildOverrideDetailsBase([
            { label: 'Motivo richiesta', value: 'Veicolo cauzione immatricolato prima del 2020' },
            { label: 'Targa cauzione', value: formData.cauzione_targa },
            { label: 'Veicolo cauzione', value: `${data.brand || ''} ${data.model || ''}`.trim() || '—' },
            { label: 'Anno immatricolazione', value: String(data.year || '?') },
          ]))
          requestOverride('vehicle_year_too_old', `Veicolo immatricolato nel ${data.year || '?'}: deve essere dal 2020 in poi per la cauzione.`)
        }
      }
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
        // Buffer post-noleggio (default 75 = 30min stacco + 45min lavaggio).
        // Letto da Centralina Pro > Automazioni via getRentalBufferMinutes().
        const earliestAvailable = new Date(latestConflictEnd.getTime() + getRentalBufferMinutes() * 60 * 1000)
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

  // Pickup/dropoff locations: built-ins (office, domicilio) + configurable
  // entries from Centralina Pro (Servizi → Luoghi di Ritiro). Fee is
  // computed as km × delivery.price_per_km in configOverlay.
  const LOCATIONS = useMemo(() => [
    { value: 'dr7_office', label: 'Viale Marconi, 229, 09131 Cagliari CA', fee: 0 },
    ...configOverlay.pickupLocations.map(p => ({
      value: p.id,
      label: `${p.label} (+€${p.fee.toFixed(2)})`,
      fee: p.fee,
    })),
    { value: 'domicilio', label: 'Consegna a domicilio (inserisci indirizzo)', fee: 0 },
  ], [configOverlay.pickupLocations])

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
          const patNum = customer.patente || customer.numero_patente || customer.metadata?.patente?.numero || '—'
          setOverrideDetails(buildOverrideDetailsBase([
            { label: 'Motivo richiesta', value: 'Patente scaduta' },
            { label: 'Numero patente', value: String(patNum) },
            { label: 'Scadenza patente', value: expDate.toLocaleDateString('it-IT') },
          ]))
          requestOverride('license_expired', `Patente scaduta il ${expDate.toLocaleDateString('it-IT')}. Il cliente non può noleggiare con patente scaduta.`)
          return ['__limitation_override_requested__']
        }
      }

      // Check patente is at least 3 years old
      const patenteDate = customer.data_rilascio_patente || customer.metadata?.patente?.rilascio
      if (patenteDate) {
        const licYears = calculateLicenseYears(patenteDate)
        if (licYears < 3 && !hasOverride('license_too_recent')) {
          const patNum = customer.patente || customer.numero_patente || customer.metadata?.patente?.numero || '—'
          setOverrideDetails(buildOverrideDetailsBase([
            { label: 'Motivo richiesta', value: 'Patente rilasciata da meno di 3 anni' },
            { label: 'Numero patente', value: String(patNum) },
            { label: 'Data rilascio patente', value: new Date(patenteDate).toLocaleDateString('it-IT') },
            { label: 'Anni patente', value: `${licYears} anni` },
          ]))
          requestOverride('license_too_recent', 'Patente rilasciata da meno di 3 anni. Il cliente non può noleggiare.')
          return ['__limitation_override_requested__']
        }
      }

      // Tier-based validation: block no_cauzione for TIER_1
      if (customer.data_nascita && patenteDate) {
        const age = calculateAge(customer.data_nascita)
        const licYears = calculateLicenseYears(patenteDate)
        const tier = classifyDriverTier(age, licYears)
        // Skip driver_blocked when the only reason is the < 3 years license:
        // that case is already covered by the more specific `license_too_recent`
        // OTP just above. Without this skip the admin had to approve TWO
        // overlapping popups for the same license-age condition.
        const blockedOnlyForLicense = licYears < 3 && age >= 21 && age < 70
        if (tier.tier === 'BLOCKED' && !blockedOnlyForLicense && !hasOverride('driver_blocked')) {
          setOverrideDetails(buildOverrideDetailsBase([
            { label: 'Motivo richiesta', value: `Cliente non idoneo al noleggio: ${tier.reason}` },
            { label: 'Eta cliente', value: `${age} anni` },
            { label: 'Anni patente', value: `${licYears} anni` },
          ]))
          requestOverride('driver_blocked', `Cliente non idoneo al noleggio: ${tier.reason}`)
          return ['__limitation_override_requested__']
        }
        if (tier.tier === 'TIER_1' && formData.deposit_status === 'no_cauzione' && !hasOverride('tier1_no_cauzione')) {
          setOverrideDetails(buildOverrideDetailsBase([
            { label: 'Motivo richiesta', value: 'No Cauzione richiesta per cliente Fascia B' },
            { label: 'Eta cliente', value: `${age} anni` },
            { label: 'Anni patente', value: `${licYears} anni` },
          ]))
          requestOverride('tier1_no_cauzione', 'No Cauzione non disponibile per clienti Fascia B (età 21-25 o patente 3-4 anni).')
          return ['__limitation_override_requested__']
        }
        if (formData.deposit_status === 'no_cauzione' && formData.insurance_option === 'RCA' && !hasOverride('no_cauzione_rca_only')) {
          setOverrideDetails(buildOverrideDetailsBase([
            { label: 'Motivo richiesta', value: 'No Cauzione abbinata a RCA (Kasko mancante)' },
          ]))
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
          booking: {
            id: booking.id,
            service_type: booking.service_type || 'car_rental',
          },
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
      toast.error('Errore: nessun ID prenotazione')
      return
    }

    // Skip contract for non-rental bookings — visible feedback invece di silent return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svcType = booking.service_type || (booking as any).booking_details?.service_type || ''
    if (svcType === 'car_wash' || svcType === 'mechanical_service' || svcType === 'mechanical') {
      logger.log(`[handleGenerateContract] Skipping — service_type=${svcType} is not a rental`)
      toast(`Contratto non richiesto per ${svcType}`, { duration: 6000 })
      return
    }

    // 1. Validate Data
    let missing: string[]
    try {
      missing = await validateCustomerData(booking)
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('[handleGenerateContract] Validation error:', error)
      toast.error('Validazione fallita: ' + _errMsg, { duration: 12000 })
      return
    }

    // Limitation override: una condizione del cliente (patente scaduta,
    // < 3 anni, driver blocked, Fascia B no_cauzione, no_cauzione+RCA) ha
    // aperto il modal OTP. Mostriamo un toast cosi' l'admin sa perche'
    // il bottone "non ha fatto nulla" — il modal e' aperto in un altro
    // punto e richiede approvazione direzione.
    if (missing.includes('__limitation_override_requested__')) {
      toast('Richiesta OTP aperta — controlla il modal di approvazione direzione', { duration: 10000, icon: 'WARN' })
      return
    }

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

      const data = await response.json().catch(() => ({} as Record<string, unknown>))

      if (!response.ok) {
        throw new Error((data.error as string) || (data.message as string) || `HTTP ${response.status}`)
      }

      // Open PDF in new tab — show explicit feedback when there's nothing to open
      // (skipped car_wash, success: false, missing url, etc.) so the button
      // never silently does nothing.
      if (data.url) {
        window.open(data.url as string, '_blank')
        toast.success('Contratto generato')
      } else if (data.skipped) {
        toast.error('Contratto non generato: ' + ((data.reason as string) || 'Servizio non richiede contratto'), { duration: 10000 })
      } else {
        toast.error(
          'Contratto non generato: backend ha risposto OK ma senza URL. Dettagli: ' + JSON.stringify(data).slice(0, 200),
          { duration: 12000 }
        )
        console.error('[generate-contract] empty url response:', data)
      }

      logAdminAction('generate_contract', 'booking', booking.id, buildBookingContext(booking))

      // Reload data to show the contract link in the UI
      await loadData()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error generating contract:', error)
      toast.error('Errore generazione contratto: ' + _errMsg, { duration: 12000 })
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
            booking: {
              id: booking.id,
              service_type: booking.service_type || 'car_rental',
            },
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
    // OTP gate (configurabile da Gestione OTP > action 'booking.delete').
    // Se la regola e' disattivata in Gestione OTP, isOtpRequired ritorna false
    // e requestOverride auto-approva senza popup. Direzione approva
    // l'OTP -> richiamare manualmente Cancella di nuovo per procedere.
    // Test bookings (veicolo TEST*) bypassano sempre l'OTP.
    const bookingToDelete = bookings.find(b => b.id === bookingId)
    if (!isTestBooking(bookingToDelete) && !hasOverride('booking.delete')) {
      requestOverride('booking.delete', 'Eliminare una prenotazione richiede autorizzazione direzionale.')
      if (!hasOverride('booking.delete')) return // OTP modal aperto, esci
    }
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

        // Notify customer via WhatsApp template "booking_cancelled_whatsapp"
        // (gestito in Messaggi di Sistema Pro). Non-blocking: se manca il
        // template o il telefono, log + continua.
        const cancelledBooking = booking || bookings.find(b => b.id === bookingId)
        const custPhone = cancelledBooking?.customer_phone
          || cancelledBooking?.booking_details?.customer?.phone
        if (custPhone) {
          try {
            await authFetch('/.netlify/functions/send-whatsapp-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customPhone: custPhone,
                booking: {
                  id: bookingId,
                  service_type: cancelledBooking?.service_type || 'car_rental',
                },
                // EVENTO LEGACY: il resolver server cerca il template che
                // ha ticchettato `booking_cancelled_whatsapp` in Eventi
                // gestiti (Messaggi di Sistema Pro). Cosi' non si confonde
                // con il template del cliente che si auto-cancella dal
                // sito (quello ha `website_booking_cancelled_customer`).
                templateKey: 'booking_cancelled_whatsapp',
                templateVars: {
                  custName: cancelledBooking?.customer_name || 'Cliente',
                  customer_name: cancelledBooking?.customer_name || 'Cliente',
                  bookingRef: `DR7-${bookingId.slice(0, 8).toUpperCase()}`,
                  vehicle_name: cancelledBooking?.vehicle_name || '',
                  pickup_date: cancelledBooking?.pickup_date || '',
                  dropoff_date: cancelledBooking?.dropoff_date || '',
                },
              }),
            })
          } catch (waErr) {
            console.warn('[handleDeleteBooking] WhatsApp cancellation send failed (non-blocking):', waErr)
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

    // OTP gate is NOT here anymore — modifying a paid/confirmed booking
    // opens the form immediately. The OTP is requested at save time
    // (processBookingSubmission) so the email to direzione can include
    // the actual diff of what changed.

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

    const editSnap = {
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
      // Track conferma state at load so the save handler can detect
      // a pending->paid transition on an already-confirmed booking and
      // skip the duplicate "Conferma Noleggio" send (the customer already
      // got "Conferma Da Saldare" on initial save; on payment they only
      // need the per-method "Pagamento ricevuto", not another conferma).
      _wasConfirmedAtLoad: booking.booking_details?.manually_confirmed === true,
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
      // Insurance resolution:
      // 1. booking.insurance_option (top-level column, written by RPC + admin)
      // 2. booking_details.insuranceOption (camelCase, written by the website wizard)
      // 3. Default KASKO_BASE only if both are missing.
      // The legacy reader (insuranceOption only) defaulted to KASKO_BASE
      // whenever the wizard hadn't written that nested field, so wallet
      // bookings showed the wrong tier in admin (Massimo Runchina case).
      insurance_option: (booking as { insurance_option?: string }).insurance_option
        || booking.booking_details?.insuranceOption
        || 'KASKO_BASE',
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
      // 2026-05-17: ripristina pacchetti KM extra dal booking esistente
      // cosi' l'admin vede subito quali ha comprato il cliente e puo'
      // aggiungerne/rimuoverne. Senza questa restore il modal apriva
      // con km_packages={} (vuoto) → l'operatore non vedeva il pacchetto
      // gia' acquistato e quando ne aggiungeva uno nuovo, il ricalcolo
      // appariva come se fosse l'unico (subtotale rimaneva apparentemente
      // invariato perche\' il vecchio pacchetto era invisibile).
      km_packages: (() => {
        const out: Record<string, number> = {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (booking.booking_details as any)?.km_packages
        if (Array.isArray(raw)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const p of raw as any[]) {
            if (!p || !p.id) continue
            const q = Number(p.quantity) || 1
            if (q > 0) out[String(p.id)] = q
          }
        }
        // Backward-compat: legacy single-package shape booking_details.km_package
        // (object) with id + quantity.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const single = (booking.booking_details as any)?.km_package
        if (single && typeof single === 'object' && single.id && !out[single.id]) {
          const q = Number(single.quantity) || 1
          if (q > 0) out[String(single.id)] = q
        }
        return out
      })(),
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
    }
    setFormData(editSnap)
    // Snapshot the populated form state. processBookingSubmission diffs
    // it against the live formData at Salva time, so the OTP email shows
    // only fields actually modified by the operator (not parsing/format
    // differences between booking_details shapes and the form's keys).
    editFormSnapshotRef.current = editSnap

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

        // Send to customer phone — resolve from multiple sources.
        // CRITICAL: NON inviare la conferma cliente se l'estensione richiede
        // ancora un pagamento. Altrimenti il cliente riceve "estensione
        // confermata" PRIMA di aver pagato. La conferma post-pagamento parte
        // dal callback Nexi (payment_received_extension) o quando l'admin
        // marca pagato manualmente.
        const extensionFullySettled = additionalAmount <= 0
          || extendData.extension_payment_status === 'paid'
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

        if (customerPhone && extensionFullySettled) {
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

          // Per le estensioni mandiamo al cliente lo STESSO template della
          // conferma noleggio (pro_conferma_noleggio) — l'utente non vuole un
          // messaggio "Modifica" o "Estensione" separato, ma la conferma
          // riepilogativa con i nuovi dati. Passiamo l'oggetto booking
          // aggiornato cosi' send-whatsapp-notification popola tutte le var.
          void customerFirstName; void vehicleNameForMsg; void extraDaysCount  // var non usate sotto
          const updatedBooking = {
            ...extendingBooking,
            ...(newVehicle ? {
              vehicle_id: newVehicle.id,
              vehicle_name: newVehicle.display_name,
              vehicle_plate: newVehicle.plate || newVehicle.targa || '',
            } : {}),
            dropoff_date: newDropoffDateTime.toISOString(),
            booking_details: updatedBookingDetails,
            isEdit: false, // forza il template rental_new (conferma) invece di rental_modified
          }
          const waResp = await fetch('/.netlify/functions/send-whatsapp-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customPhone: customerPhone,
              booking: updatedBooking,
              skipHeader: true,
            })
          })
          const waResult = await waResp.json().catch(() => ({}))
          if (!waResp.ok || waResult?.skipped) {
            toast.error('Template mancante in Messaggi di Sistema Pro: pro_conferma_noleggio')
          } else {
            logger.log('[handleConfirmExtend] ✅ WhatsApp customer notification sent to', customerPhone)
          }
        } else if (!customerPhone) {
          logger.warn('[handleConfirmExtend] ⚠️ No customer phone — skipped customer notification')
        } else {
          logger.log('[handleConfirmExtend] ⏸️ Conferma cliente NON inviata: estensione con pagamento ancora pendente (' + extendData.extension_payment_status + '). Verrà inviata dopo il pagamento.')
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

      // DR7 Privilege — fire on extension paid. Gated STRICTLY on
      // extension_payment_status === 'paid' (NEVER on confirmed alone).
      // Backend idempotente via dr7_privilege_sent_at, niente doppio invio
      // se il privilege era gia' partito alla prenotazione iniziale.
      if (extendData.extension_payment_status === 'paid' && extendingBooking?.id) {
        authFetch('/.netlify/functions/trigger-dr7-privilege', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: extendingBooking.id, kind: 'noleggio' }),
        }).catch(() => { /* non-blocking */ })
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

      // Generate Nexi Pay by Link for extension.
      // Defensive: 1) we DO know if the link generation succeeded; 2) we DO
      // check the WhatsApp send result; 3) on ANY failure (no phone, template
      // disabled, Green API offline, link gen error) we copy the link to the
      // clipboard and show a yellow warning so the admin sends it manually.
      if (extendData.extension_payment_status === 'nexi_pay_by_link' && additionalAmount > 0) {
        let nexiLink: string | null = null
        let waSent = false
        let waReason = ''
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
          const linkData = await linkRes.json().catch(() => ({}))

          if (linkRes.ok && linkData.paymentUrl) {
            nexiLink = linkData.paymentUrl
            // Persist the link on the booking BEFORE attempting WhatsApp, so
            // even if everything below fails the admin can still find it.
            await supabase.from('bookings').update({
              booking_details: {
                ...updatedBookingDetails,
                nexi_payment_link: linkData.paymentUrl,
                nexi_order_id: linkData.orderId,
              }
            }).eq('id', extendingBooking.id)

            if (customerPhone) {
              const bookingRef = extendingBooking.id.substring(0, 8).toUpperCase()
              try {
                const expiryLabel = `${expirationHours} ${expirationHours === 1 ? 'ora' : 'ore'}`
                // Pass every common name placeholder variant — admin's
                // template in Messaggi di Sistema Pro can use {nome},
                // {customer_name}, {cliente}, etc. Without aliasing, only
                // the variant that matches the template ever resolves and
                // the others get sent literally to the customer.
                const waRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    customPhone: customerPhone,
                    booking: {
                      id: extendingBooking.id,
                      service_type: extendingBooking.service_type || 'car_rental',
                    },
                    templateKey: 'payment_link_customer',
                    templateVars: {
                      '{nome}': custName,
                      '{customer_name}': custName,
                      '{cliente}': custName,
                      '{name}': custName,
                      '{booking_id}': bookingRef,
                      '{total}': additionalAmount.toFixed(2),
                      '{payment_link}': linkData.paymentUrl,
                      '{expiry}': expiryLabel,
                    }
                  })
                })
                const waJson = await waRes.json().catch(() => ({}))
                if (!waRes.ok) {
                  waReason = `server: ${waJson.message || waJson.error || waRes.status}`
                } else if (waJson.skipped) {
                  // send-whatsapp-notification returns 200 + skipped:true when
                  // template disabled, missing, or Green API not configured.
                  waReason = `template/Green API: ${waJson.reason || waJson.message || 'skipped'}`
                } else {
                  waSent = true
                }
              } catch (waErr: unknown) {
                waReason = waErr instanceof Error ? waErr.message : String(waErr)
              }
            } else {
              waReason = 'cliente senza numero di telefono'
            }
          } else {
            // Nexi link generation failed
            toast.error('Errore Pay by Link: ' + (linkData.error || 'Errore'))
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (linkErr: any) {
          console.error('[handleConfirmExtend] Pay by Link error:', linkErr)
          toast.error('Errore Pay by Link: ' + linkErr.message)
        }

        // Final feedback. Three outcomes:
        //   1) link generated AND WhatsApp queued → success
        //   2) link generated, WhatsApp NOT delivered → warn + copy to clipboard
        //   3) link generation itself failed → already shown above (toast.error)
        if (nexiLink) {
          if (waSent) {
            toast.success(`Pay by Link estensione inviato via WhatsApp! €${additionalAmount.toFixed(2)}`)
          } else {
            // Copy link via DOM fallback (Safari blocks navigator.clipboard
            // after async fetch — exec falls back to a hidden textarea).
            try {
              const ta = document.createElement('textarea')
              ta.value = nexiLink
              ta.style.position = 'fixed'
              ta.style.opacity = '0'
              document.body.appendChild(ta)
              ta.select()
              document.execCommand('copy')
              document.body.removeChild(ta)
            } catch { /* ignore — link is on the booking anyway */ }
            toast(
              `Link generato MA WhatsApp non inviato (${waReason}). Link copiato negli appunti — invialo manualmente al cliente.`,
              { icon: '⚠️', duration: 9000, style: { background: '#78350f', color: '#fef3c7', maxWidth: '480px' } }
            )
          }
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

    // Re-entry guard PRIMA di qualsiasi side-effect (modali OTP, fetch DB,
    // WhatsApp send). isSubmitting e' async => doppio click rapido entra
    // due volte qui prima del re-render. Il ref e' sincrono => secondo
    // ingresso bail-out immediato senza spawnare alcun modal/sending.
    if (submitLockRef.current || isSubmitting) return
    submitLockRef.current = true

    // 2026-05-18: helper per abort quando si apre la modale OTP — salva
    // skipValidation/overrideCustomerId in pendingSubmitRef cosi' la
    // useEffect su overrideCodes ri-fira processBookingSubmission dopo
    // l'approvazione. Niente piu' "click OK → devo ri-cliccare Salva".
    const abortForOtp = () => {
      pendingSubmitRef.current = { skipValidation, overrideCustomerId }
      setIsSubmitting(false)
      submitLockRef.current = false
    }

    // ─── OTP gates (Salva-time) ─────────────────────────────────────────
    // Valutiamo TUTTI i gate insieme: se più condizioni richiedono
    // autorizzazione, la direzione riceve UNA sola email con TUTTE le
    // motivazioni reali. All'approvazione della prima limitation marchiamo
    // come autorizzati anche i codici aggiuntivi tripped (stesso overrideId).
    {
      type ComboTrip = { code: string; motivazione: string }
      const trips: ComboTrip[] = []

      // (a) Fuori orario standard (pickup e/o riconsegna)
      if (!hasOverride('out_of_office_hours')) {
        const pickupOff = formData.pickup_date && formData.pickup_time
          && !isInRentalHours(formData.pickup_date, formData.pickup_time, 'pickup')
        const returnOff = formData.return_date && formData.return_time
          && !isInRentalHours(formData.return_date, formData.return_time, 'return')
        if (pickupOff || returnOff) {
          const fmt = (m: number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
          const describe = (date: string, time: string, kind: 'pickup' | 'return') => {
            const r = rentalHoursFor(date, kind)
            const hoursLabel = r ? r.map(([a, b]) => `${fmt(a)}-${fmt(b)}`).join(' / ') : 'Domenica chiusa'
            const verb = kind === 'pickup' ? 'Ritiro' : 'Riconsegna'
            return `${verb} alle ${time} fuori orario standard (orari: ${hoursLabel})`
          }
          const parts: string[] = []
          if (pickupOff) parts.push(describe(formData.pickup_date, formData.pickup_time, 'pickup'))
          if (returnOff) parts.push(describe(formData.return_date, formData.return_time, 'return'))
          trips.push({ code: 'out_of_office_hours', motivazione: `Fuori orario — ${parts.join(' · ')}` })
        }
      }

      // (b) Modifica prenotazione pagata/confermata
      let editDiffDetails: Array<{ label: string; value: string }> | null = null
      if (editingId && !hasOverride('paid_rental_modify')) {
        const original = bookings.find(b => b.id === editingId)
        if (original) {
          const PAID = ['paid', 'completed', 'succeeded']
          const CONFIRMED = ['confirmed', 'confermata', 'active', 'in_corso']
          const isPaid = PAID.includes((original.payment_status || '').toLowerCase())
          const isConfirmed = CONFIRMED.includes((original.status || '').toLowerCase())
          if (isPaid || isConfirmed) {
            const cust = customers.find(c => c.id === formData.customer_id)
            const customerNameForDiff = cust?.full_name
              || original.customer_name
              || original.booking_details?.customer?.fullName
              || original.booking_details?.customer?.name
              || '—'
            const before = editFormSnapshotRef.current || formData
            editDiffDetails = buildBookingEditDiff(before, formData, String(customerNameForDiff), original.id, vehicles)
            trips.push({
              code: 'paid_rental_modify',
              motivazione: 'Modifica di una prenotazione pagata o confermata',
            })
          }
        }
      }

      // (c) No Cauzione + Fascia B
      if (
        formData.deposit_status === 'no_cauzione'
        && customerTier?.tier === 'TIER_1'
        && !hasOverride('tier1_no_cauzione')
      ) {
        trips.push({
          code: 'tier1_no_cauzione',
          motivazione: 'No Cauzione richiesta per cliente Fascia B (età 21-25 o patente 3-4 anni)',
        })
      }

      // (d) No Cauzione + RCA only (richiede Kasko attiva)
      if (
        formData.deposit_status === 'no_cauzione'
        && formData.insurance_option === 'RCA'
        && !hasOverride('no_cauzione_rca_only')
      ) {
        trips.push({
          code: 'no_cauzione_rca_only',
          motivazione: 'No Cauzione abbinata a RCA: richiesta autorizzazione perché manca la Kasko',
        })
      }

      // (e) Driver bloccato (età <21, ≥70 o patente <3 anni)
      if (customerTier?.tier === 'BLOCKED' && !hasOverride('driver_blocked')) {
        trips.push({
          code: 'driver_blocked',
          motivazione: `Cliente non idoneo al noleggio: ${customerTier.reason || 'fascia bloccata'}`,
        })
      }

      // Filtro Gestione OTP: rimuoviamo dalla lista trips i codici che la
      // direzione ha disattivato in system_otp_overrides (is_required=false).
      // Per quei codici chiamiamo requestOverride: il hook auto-bypassa
      // (synthetic bypass id) senza aprire la modal e senza inviare email.
      // Risultato: disattivare un OTP nel tab Gestione OTP lo disattiva
      // davvero anche per i bookings.
      const filteredTrips: ComboTrip[] = []
      for (const t of trips) {
        if (!isOtpRequired(t.code)) {
          // Bypass silenzioso — il hook setta l'override in mappa.
          requestOverride(t.code, t.motivazione)
          continue
        }
        filteredTrips.push(t)
      }
      // Sostituiamo la lista così la modal mostra solo motivazioni
      // realmente attive.
      trips.length = 0
      trips.push(...filteredTrips)

      if (trips.length > 0) {
        // Snapshot del booking nell'email — la direzione vede chi/cosa/quando/quanto.
        const cust = customers.find(c => c.id === formData.customer_id)
        const newName = `${newCustomerData?.nome || ''} ${newCustomerData?.cognome || ''}`.trim()
        const customerName = newCustomerMode
          ? (newName || newCustomerData?.denominazione || '—')
          : (cust?.full_name || '—')
        const customerPhone = newCustomerMode
          ? (newCustomerData?.telefono || '—')
          : (cust?.phone || '—')
        const veh = vehicles.find(v => v.id === formData.vehicle_id)
        const vehLabel = veh ? `${veh.display_name}${veh.plate ? ` (${veh.plate})` : ''}` : '—'
        const fmtDate = (d: string, t: string) => {
          if (!d) return '—'
          const [y, mo, da] = d.split('-')
          return y && mo && da ? `${da}/${mo}/${y} ${t || ''}`.trim() : `${d} ${t || ''}`.trim()
        }
        const eur = (n: unknown) => {
          const num = typeof n === 'number' ? n : parseFloat(String(n ?? 0))
          return Number.isFinite(num)
            ? `€${num.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : '—'
        }
        const baseDetails: Array<{ label: string; value: string }> = [
          { label: 'Operazione', value: editingId ? 'Modifica prenotazione' : 'Nuova prenotazione' },
          { label: 'Cliente', value: customerName },
          { label: 'Telefono', value: customerPhone },
          { label: 'Veicolo', value: vehLabel },
          { label: 'Ritiro', value: fmtDate(formData.pickup_date, formData.pickup_time) },
          { label: 'Riconsegna', value: fmtDate(formData.return_date, formData.return_time) },
          { label: 'Luogo ritiro', value: formData.pickup_location || '—' },
          { label: 'Totale', value: eur(formData.total_amount) },
          { label: 'Cauzione', value: formData.deposit_status === 'no_cauzione' ? 'No Cauzione' : eur(formData.deposit) },
          { label: 'Pagamento', value: formData.payment_method || '—' },
        ]
        if (editingId) baseDetails.splice(1, 0, { label: 'Prenotazione', value: editingId.slice(0, 8) })

        // Payload strutturato — la direzione vede sezioni colorate:
        //   gate (rosso): motivazioni (perche' scatta l'OTP)
        //   customer (blu): nome, telefono
        //   diff (ambra): Prima→Dopo per ogni campo cambiato (solo se modifica)
        //   operation (categoria): veicolo, date, importi, pagamento
        //   meta (grigio): timestamp
        const motivazioni: Record<string, string> = {}
        if (trips.length === 1) {
          motivazioni['Motivo'] = trips[0].motivazione
        } else {
          trips.forEach((t, i) => { motivazioni[`Motivo ${i + 1}`] = t.motivazione })
        }
        // Trasforma editDiffDetails (array di {label, value}) in diff strutturato.
        // buildBookingEditDiff produce righe del tipo:
        //   { label: 'Data ritiro', value: '15/05/2026 10:00 → 16/05/2026 10:00' }
        // Splittiamo sul ' → ' per ottenere before/after; se non c'e' separatore
        // mettiamo tutto in `after` (caso edge).
        const diffStructured: Array<{ field: string; before: string; after: string }> = []
        if (editDiffDetails) {
          for (const row of editDiffDetails) {
            const v = String(row.value || '')
            const arrowIdx = v.indexOf(' → ')
            if (arrowIdx > -1) {
              diffStructured.push({ field: row.label, before: v.slice(0, arrowIdx).trim(), after: v.slice(arrowIdx + 3).trim() })
            } else {
              diffStructured.push({ field: row.label, before: '', after: v })
            }
          }
        }
        const finalDetails = {
          gate: motivazioni,
          customer: { Nome: customerName, Telefono: customerPhone },
          ...(diffStructured.length > 0 ? { diff: diffStructured } : {}),
          operation: {
            'Tipo operazione': editingId ? 'Modifica prenotazione' : 'Nuova prenotazione',
            ...(editingId ? { 'Riferimento': `DR7-${editingId.slice(0, 8).toUpperCase()}` } : {}),
            Veicolo: vehLabel,
            Ritiro: fmtDate(formData.pickup_date, formData.pickup_time),
            Riconsegna: fmtDate(formData.return_date, formData.return_time),
            'Luogo ritiro': formData.pickup_location || '—',
            Totale: eur(formData.total_amount),
            Cauzione: formData.deposit_status === 'no_cauzione' ? 'No Cauzione' : eur(formData.deposit),
            Pagamento: formData.payment_method || '—',
          },
          meta: {
            'Data richiesta': new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
          },
        }
        void baseDetails // legacy var conservata ma non usata nel nuovo payload

        setOverrideDetails(finalDetails)

        const primary = trips[0]
        const extras = trips.slice(1).map(t => t.code)
        comboExtraCodesRef.current = extras
        comboMessageRef.current = trips.map(t => t.motivazione).join(' · ')

        const limitationMessage = trips.length === 1
          ? primary.motivazione
          : `${trips.length} condizioni richiedono autorizzazione`

        pendingSubmitRef.current = { skipValidation, overrideCustomerId }
        // Test bookings bypassano sempre l'OTP — operatori QA non devono
        // ricevere autorizzazioni direzionali per i veicoli di test.
        const selectedVeh = vehicles.find(v => v.id === formData.vehicle_id)
        const isTestRental = isTestVehicle(selectedVeh?.display_name || null, selectedVeh?.plate || null)
        // 2026-05-18: requestOverride ritorna true se bypassato (admin in
        // OTP_BYPASS_EMAILS o test rental). In quel caso NON abortiamo: il
        // save continua subito, niente toast/alert/click extra.
        const wasBypassed = requestOverride(
          primary.code,
          limitationMessage,
          {
            audit: primary.code === 'paid_rental_modify' ? `booking_edit_${editingId}` : undefined,
            bypass: isTestRental,
          },
        )
        if (!wasBypassed) {
          // pendingSubmitRef gia' settato a riga 4074, l'auto-resume
          // riprende dopo l'approvazione OTP.
          submitLockRef.current = false
          return
        }
        // bypassed: prosegui col save
      }
    }

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
            setOverrideDetails(buildOverrideDetailsBase([
              { label: 'Motivo richiesta', value: `Cliente non idoneo al noleggio: ${customerTier.reason || 'fascia bloccata'}` },
            ]))
            if (!requestOverride('driver_blocked', `Cliente non idoneo al noleggio: ${customerTier.reason}`)) {
              abortForOtp()
              return
            }
          }
          if (customerTier?.tier === 'TIER_1' && formData.deposit_status === 'no_cauzione' && !hasOverride('tier1_no_cauzione')) {
            setOverrideDetails(buildOverrideDetailsBase([
              { label: 'Motivo richiesta', value: 'No Cauzione richiesta per cliente Fascia B' },
            ]))
            if (!requestOverride('tier1_no_cauzione', 'No Cauzione non disponibile per clienti Fascia B (età 21-25 o patente 3-4 anni).')) {
              abortForOtp()
              return
            }
          }
          if (formData.deposit_status === 'no_cauzione' && formData.insurance_option === 'RCA' && !hasOverride('no_cauzione_rca_only')) {
            setOverrideDetails(buildOverrideDetailsBase([
              { label: 'Motivo richiesta', value: 'No Cauzione abbinata a RCA (Kasko mancante)' },
            ]))
            if (!requestOverride('no_cauzione_rca_only', 'No Cauzione richiede una Kasko attiva. Seleziona una Kasko prima di procedere.')) {
              abortForOtp()
              return
            }
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
          submitLockRef.current = false
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
          submitLockRef.current = false
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
                const patNum = customer.patente || customer.numero_patente || customer.metadata?.patente?.numero || '—'
                setOverrideDetails(buildOverrideDetailsBase([
                  { label: 'Motivo richiesta', value: 'Patente rilasciata da meno di 3 anni' },
                  { label: 'Numero patente', value: String(patNum) },
                  { label: 'Data rilascio patente', value: new Date(patenteDate).toLocaleDateString('it-IT') },
                  { label: 'Anni patente', value: `${licYears} anni` },
                ]))
                if (!requestOverride('license_too_recent', 'Patente rilasciata da meno di 3 anni. Il cliente non può noleggiare.')) {
                  abortForOtp()
                  return
                }
              }
            }
            if (customer.data_nascita && patenteDate) {
              const age = calculateAge(customer.data_nascita)
              const licYears = calculateLicenseYears(patenteDate)
              const tier = classifyDriverTier(age, licYears)
              if (tier.tier === 'BLOCKED' && !hasOverride('driver_blocked')) {
                setOverrideDetails(buildOverrideDetailsBase([
                  { label: 'Motivo richiesta', value: `Cliente non idoneo al noleggio: ${tier.reason}` },
                  { label: 'Eta cliente', value: `${age} anni` },
                  { label: 'Anni patente', value: `${licYears} anni` },
                ]))
                if (!requestOverride('driver_blocked', `Cliente non idoneo al noleggio: ${tier.reason}`)) {
                  abortForOtp()
                  return
                }
              }
              if (tier.tier === 'TIER_1' && formData.deposit_status === 'no_cauzione' && !hasOverride('tier1_no_cauzione')) {
                setOverrideDetails(buildOverrideDetailsBase([
                  { label: 'Motivo richiesta', value: 'No Cauzione richiesta per cliente Fascia B' },
                  { label: 'Eta cliente', value: `${age} anni` },
                  { label: 'Anni patente', value: `${licYears} anni` },
                ]))
                if (!requestOverride('tier1_no_cauzione', 'No Cauzione non disponibile per clienti Fascia B (età 21-25 o patente 3-4 anni).')) {
                  abortForOtp()
                  return
                }
              }
            }
            if (formData.deposit_status === 'no_cauzione' && formData.insurance_option === 'RCA' && !hasOverride('no_cauzione_rca_only')) {
              setOverrideDetails(buildOverrideDetailsBase([
                { label: 'Motivo richiesta', value: 'No Cauzione abbinata a RCA (Kasko mancante)' },
              ]))
              if (!requestOverride('no_cauzione_rca_only', 'No Cauzione richiede una Kasko attiva. Seleziona una Kasko prima di procedere.')) {
                abortForOtp()
                return
              }
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
            submitLockRef.current = false
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
          submitLockRef.current = false
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
        submitLockRef.current = false
        return // STOP HERE - do not create booking until missing data is provided
      }
    }

    // DEFENSIVE CHECK: Ensure we don't proceed if validation triggered the modal
    // This prevents race conditions where state updates haven't propagated yet
    if (showMissingDataModal) {
      logger.log('[processBookingSubmission] ⚠️ Modal is open, aborting booking creation')
      setIsSubmitting(false)
      submitLockRef.current = false
      return
    }

    // ===== VALIDATION PASSED - PROCEEDING WITH BOOKING CREATION =====
    logger.log('[processBookingSubmission] ✅ All validation passed, proceeding with booking creation')
    logger.log('[processBookingSubmission] Customer ID:', formData.customer_id || 'new customer')

    // Call the original submit logic (embedded here or separate)

    // (Il re-entry guard sincrono e' gia' stato applicato in cima alla
    // funzione — qui ci limitiamo a marcare lo stato React "in submitting".)
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
        submitLockRef.current = false
        return
      }

      // ===== VALIDATION: Check pickup is not in the past (only for NEW bookings) =====
      if (!editingId) {
        const nowRome = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }))
        const pickupCheck = new Date(`${formData.pickup_date}T${formData.pickup_time}:00`)
        if (pickupCheck < nowRome && !hasOverride('pickup_in_past')) {
          setOverrideDetails(buildOverrideDetailsBase([
            { label: 'Motivo richiesta', value: 'Data e ora di ritiro nel passato' },
            { label: 'Ora attuale (Roma)', value: nowRome.toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) },
          ]))
          if (!requestOverride('pickup_in_past', 'La data e ora di ritiro è nel passato. Serve autorizzazione per procedere.')) {
            abortForOtp()
            return
          }
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
        submitLockRef.current = false
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
        submitLockRef.current = false
        return
      }

      // ===== VALIDATION: Home Delivery fields =====
      // 2026-05-18: solo Città + Costo sono richiesti. Indirizzo completo
      // (via/CAP/provincia) e' opzionale — l'utente vuole poter mettere
      // solo "Cagliari" senza dover compilare l'indirizzo intero.
      if (formData.delivery_enabled) {
        const deliveryMissing: string[] = []
        if (!formData.delivery_city.trim()) deliveryMissing.push('Città (consegna)')
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
          submitLockRef.current = false
          return
        }
      }

      // ===== VALIDATION: Home Pickup fields =====
      // 2026-05-18: solo Città + Costo sono richiesti per ritiro a domicilio.
      if (formData.pickup_enabled) {
        const pickupMissing: string[] = []
        if (!formData.pickup_city.trim()) pickupMissing.push('Città (ritiro)')
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
          submitLockRef.current = false
          return
        }
      }

      // ===== VALIDATION: Cauzione Auto — targa must be looked up =====
      // BUG FIX 2026-05-15: se la direzione ha gia' approvato l'override
      // 'vehicle_year_too_old' (OTP confermato), saltiamo la validation
      // brand/year — l'admin ha esplicitamente autorizzato il veicolo a
      // procedere come cauzione anche se la lookup non ha popolato tutti
      // i campi. Senza questo gate, il save bouncava sempre nonostante
      // l'OTP corretto.
      if (formData.cauzione_auto && !hasOverride('vehicle_year_too_old')) {
        const cauzioneMissing: string[] = []
        if (!formData.cauzione_targa || formData.cauzione_targa.length < 5) {
          cauzioneMissing.push('Targa Veicolo Cauzione')
        }
        // La verifica "Cerca cliccato" si basa sul BRAND popolato dalla
        // lookup (non sull'anno: alcune targhe non hanno anno in OpenAPI
        // e fetchTargaLookup mette 'N/D'. Senza brand invece la lookup
        // non e' stata fatta del tutto).
        if (!formData.cauzione_targa_brand) {
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
          submitLockRef.current = false
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
            setOverrideDetails(buildOverrideDetailsBase([
              { label: 'Motivo richiesta', value: 'Slot non disponibile / conflitto disponibilita' },
              { label: 'Dettaglio conflitto', value: availabilityResult.reason || 'Slot non disponibile' },
            ]))
            // 2026-05-18: requestOverride ritorna true se bypassato
            // (admin OTP_BYPASS_EMAILS: ophe/salvatore/valerio/ilenia) →
            // continuiamo senza abortire. False = modale OTP aperta → exit.
            const wasBypassed = requestOverride('slot_unavailable', availabilityResult.reason || 'Slot non disponibile')
            if (!wasBypassed) {
              abortForOtp()
              return
            }
            // bypass: l'override e' gia' in overrideMap, proseguiamo col save
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

        // Buffer pre-pickup carwash (Centralina Pro > Automazioni, default 90).
        const BUFFER_MINUTES = getPrePickupCarwashBufferMinutes()
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
        submitLockRef.current = false
        return
      }

      // ===== OTP GATE: Conferma Prenotazione (toggle in Gestione OTP) =====
      // Quando l'admin spunta "Conferma Prenotazione" e l'OTP per questa
      // azione e' attivo (system_otp_overrides.is_required=true) chiediamo
      // OTP della direzione. useLimitationOverride bypassa server-side se
      // il toggle e' OFF, quindi quando off questa chiamata non blocca nulla.
      // Test bookings (veicolo TEST*) bypassano sempre.
      const selectedVeh = vehicles.find(v => v.id === formData.vehicle_id)
      const isTestRental = isTestVehicle(selectedVeh?.display_name || null, selectedVeh?.plate || null)
      if (confirmBooking && !isTestRental && !hasOverride('prenotazione_noleggio_conferma')) {
        setOverrideDetails(buildOverrideDetailsBase([
          { label: 'Motivo richiesta', value: 'Conferma prenotazione noleggio richiede autorizzazione direzionale' },
        ]))
        if (!requestOverride('prenotazione_noleggio_conferma', 'Conferma prenotazione noleggio richiede autorizzazione direzionale')) {
          abortForOtp()
          return
        }
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
          + eurToCents(formData.delivery_fee || '0')
          + eurToCents(formData.pickup_fee || '0')),
        km_overage_fee: parseFloat(formData.km_overage_fee) || 0,
        currency: formData.currency.toUpperCase(),
        // Pay by Link bookings start as pending_payment/unpaid;
        // other payment methods start as confirmed/paid
        status: (!editingId && isNexiPayByLink(formData.payment_method) && formData.payment_status !== 'paid')
          ? 'pending' : formData.status === 'pending_payment' ? 'pending' : (formData.status || 'confirmed'),
        payment_status: (!editingId && isNexiPayByLink(formData.payment_method) && formData.payment_status !== 'paid')
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
        delivery_fee: eurToCents(formData.delivery_fee || '0'),
        pickup_enabled: formData.pickup_enabled,
        pickup_address: formData.pickup_enabled ? {
          street: formData.pickup_street,
          city: formData.pickup_city,
          zip: formData.pickup_zip,
          province: formData.pickup_province,
          notes: formData.pickup_notes
        } : null,
        pickup_fee: eurToCents(formData.pickup_fee || '0'),
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
          // 2026-05-18: persist depositOption + noDepositSurcharge for contract gen
          // and WhatsApp notifications. Previously these were only preserved from
          // existing bookings, so a fresh admin-created No Cauzione booking would
          // show €0 surcharge in the contract / pre-rental message even though the
          // amount was already added to total_amount.
          depositOption: formData.deposit_option_id
            || (formData.deposit_status === 'no_cauzione' ? 'no_deposit' : null),
          noDepositSurcharge: Math.round(
            (selectedDepositSurchargePerDay
              || (formData.deposit_status === 'no_cauzione' ? CFG_NO_CAUZIONE_PER_DAY : 0))
            * (revenueSuggestion?.rentalDays || 1) * 100
          ) / 100,
          no_cauzione_surcharge_per_day: selectedDepositSurchargePerDay
            || (formData.deposit_status === 'no_cauzione' ? CFG_NO_CAUZIONE_PER_DAY : 0),
          // KM Limit
          km_limit: formData.unlimited_km ? 'Illimitati' : formData.km_limit,
          unlimited_km: formData.unlimited_km,
          // 2026-05-16: pacchetti KM CUMULATIVI (lista).
          // booking_details.km_packages = [] di tutti i pacchetti selezionati,
          // ciascuno con qty + totali. booking_details.km_package (singolo) =
          // backward-compat se solo 1 selezionato (altrimenti null).
          km_packages: (() => {
            if (formData.unlimited_km) return []
            const list = formData.km_packages || {}
            const v = vehicles.find(vv => vv.id === formData.vehicle_id)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pkgsByCat = (rentalConfig as any)?.pacchetti_km as Record<string, Array<{ id: string; km: number; sconto_pct: number; price: number; label: string; is_quantity_buyable?: boolean; max_quantity?: number }>> | undefined
            const pkgs = resolvePacchetti(v?.category, pkgsByCat)
            const out: Array<{ id: string; label: string; km: number; sconto_pct: number; price: number; quantity: number; total_km: number; total_price: number }> = []
            for (const found of pkgs) {
              const q = list[found.id] || 0
              if (q <= 0) continue
              const cap = found.is_quantity_buyable ? Math.max(1, Number(found.max_quantity) || 2) : 1
              const clamped = Math.max(0, Math.min(cap, q))
              if (clamped > 0) {
                out.push({
                  id: found.id, label: found.label, km: found.km, sconto_pct: found.sconto_pct,
                  price: found.price, quantity: clamped,
                  total_km: found.km * clamped, total_price: Math.round(found.price * clamped * 100) / 100,
                })
              }
            }
            return out
          })(),
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
          delivery_fee: formData.delivery_fee || '0',
          pickup_enabled: formData.pickup_enabled,
          pickup_address: formData.pickup_enabled ? {
            street: formData.pickup_street,
            city: formData.pickup_city,
            zip: formData.pickup_zip,
            province: formData.pickup_province,
            notes: formData.pickup_notes
          } : null,
          pickup_fee: formData.pickup_fee || '0',
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
        // IMPORTANT: stamp updated_at on every save. The bookings table doesn't
        // have an auto-update trigger, so without this the column stays equal
        // to booked_at and we can't tell which bookings have been modified.
        const { data, error: bookingError } = await supabase
          .from('bookings')
          .update({ ...bookingData, updated_at: new Date().toISOString() })
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

        // Audit diff: capture every field that actually changed between the
        // snapshot loaded into the form (editFormSnapshotRef) and the saved
        // payload (bookingData / insertedBooking). Without this the
        // edit_booking log was a post-edit snapshot only, so we couldn't tell
        // which admin changed which field. Particularly important after the
        // insurance dropdown bug — even though the form now ghosts the stored
        // value, the diff lets us spot any future silent regression.
        const beforeSnap = editFormSnapshotRef.current
        const diff: Record<string, { from: any; to: any }> = {}
        if (beforeSnap) {
          const trackedFields = [
            'pickup_date','pickup_time','return_date','return_time',
            'pickup_location','dropoff_location',
            'vehicle_id','vehicle_plate',
            'customer_id','customer_name','customer_email','customer_phone',
            'insurance_option','deposit','deposit_status','deposit_option_id',
            'km_limit','km_overage_fee','unlimited_km',
            'total_amount','amount_paid','payment_status','payment_method',
            'has_second_driver','dr7_flex',
            'notes','vehicle_name',
          ] as const
          for (const f of trackedFields) {
            const beforeVal = (beforeSnap as Record<string, any>)[f]
            const afterVal = (bookingData as Record<string, any>)[f]
            // Coerce both to JSON-equivalent strings for stable comparison.
            const a = beforeVal === undefined ? null : beforeVal
            const b = afterVal === undefined ? null : afterVal
            if (JSON.stringify(a) !== JSON.stringify(b)) {
              diff[f] = { from: a, to: b }
            }
          }
        }

        logAdminAction('edit_booking', 'booking', editingId, {
          ...buildBookingContext(insertedBooking),
          customer: insertedBooking?.customer_name || customerInfo?.full_name,
          // Include the diff in the log so we can answer "who changed what"
          // questions like Massimo Runchina's insurance going DR7 -> Base.
          ...(Object.keys(diff).length > 0 ? { changes: diff, changes_count: Object.keys(diff).length } : {}),
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
      const isPayByLinkMethod = isNexiPayByLink(formData.payment_method)
      if (!editingId && isPendingForLink && isPayByLinkMethod && insertedBooking) {
        try {
          // Use cents-based addition to avoid float drift, then convert to EUR
          // Subtract already paid amount for partial payments
          const fullTotalCents = eurToCents(formData.total_amount || '0')
            + eurToCents(formData.delivery_fee || '0')
            + eurToCents(formData.pickup_fee || '0')
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
                    // Passa il booking cosi' il resolver vede il service_type
                    // e puo' matchare i template con filtro "solo Noleggio".
                    // Senza questo il template "Link Pagamento" (target rental)
                    // veniva scartato e il messaggio non partiva.
                    booking: {
                      id: insertedBooking.id,
                      service_type: insertedBooking.service_type || 'car_rental',
                    },
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
              + eurToCents(formData.delivery_fee || '0')
              + eurToCents(formData.pickup_fee || '0'),
            tax: 0,
            total: eurToCents(formData.total_amount)
              + eurToCents(formData.delivery_fee || '0')
              + eurToCents(formData.pickup_fee || '0'),
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
            // Admin booking-created notification. Opt-in resolves to
            // centralina_pro_config admin_whatsapp_phone server-side.
            notifyAdmin: true,
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
                delivery_fee: formData.delivery_fee || '0',
                pickup_enabled: formData.pickup_enabled,
                pickup_address: formData.pickup_enabled ? {
                  street: formData.pickup_street,
                  city: formData.pickup_city,
                  zip: formData.pickup_zip,
                  province: formData.pickup_province
                } : null,
                pickup_fee: formData.pickup_fee || '0',
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
            // 2026-05-19: {payment_info} è la composizione "metodo · stato"
            // che molti template Pro usano nella riga "Pagamento:". Senza
            // questa var il safety-net (line 271 send-whatsapp-notification.ts)
            // strippava il placeholder lasciando "Pagamento:" vuoto.
            // Alias {pagamento} aggiunto per compatibilità con template
            // scritti in italiano dall'admin.
            '{payment_info}': (() => {
              const status = isPending ? 'Da saldare' : 'Pagato'
              const method = formData.payment_method || ''
              if (!method) return status
              return `${method} · ${status}`
            })(),
            '{pagamento}': (() => {
              const status = isPending ? 'Da saldare' : 'Pagato'
              const method = formData.payment_method || ''
              if (!method) return status
              return `${method} · ${status}`
            })(),
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
          // - Any pending booking (new OR edit) → null. Conferma is delivered
          //   only AFTER payment is recorded (admin clicks "Segna Pagato",
          //   pay-by-link callback marks the row paid, etc.). Sending the
          //   confirmation before payment is misleading: customer thinks the
          //   booking is locked when it isn't yet.
          // - Conferma Prenotazione ON → rental_new_customer (works for BOTH
          //   paid AND da-saldare; the {payment_status} placeholder shows
          //   "Da saldare" when payment is still pending)
          // - Edit fully paid → rental_new_customer
          // - New + paid (no conferma checkbox) → rental_new_customer
          // - Pending (da-saldare) without conferma → null (silent until
          //   admin records the payment or explicitly ticks Conferma)
          // Regola anti-duplicato: la conferma noleggio parte UNA SOLA VOLTA
          // nella vita di una prenotazione. Una volta che il cliente ha
          // ricevuto un messaggio di conferma (Da Saldare o Noleggio),
          // qualsiasi modifica successiva (cambio data, nota, segna pagato,
          // ecc.) NON deve rispedire una nuova conferma.
          //
          // Il segnale e' booking_details.manually_confirmed: la prima volta
          // che la conferma parte, viene salvato a true. Da quel momento in
          // poi, su edit l'invio della conferma e' bloccato.
          //
          // Il messaggio per-metodo (booking_paid_cash, booking_paid_card,
          // ecc.) continua a partire al momento del pagamento — quello e' il
          // segnale corretto "abbiamo ricevuto il tuo pagamento".
          const prevSnap = editFormSnapshotRef.current
          const wasConfirmedAtLoad = prevSnap?._wasConfirmedAtLoad === true
          // 2026-05-19: Pay-by-Link "Da Saldare" deve sempre mandare la
          // conferma automaticamente, anche senza la checkbox Conferma
          // Prenotazione spuntata. Il cliente DEVE sapere che il booking
          // e' registrato + ricevere il link separato per pagare.
          const isPayByLinkPending = isNexiPayByLink(formData.payment_method) && isPending

          let templateKey: string | null
          if (editingId && wasConfirmedAtLoad) {
            // Booking gia' stato confermato in precedenza — niente reinvio
            // conferma su questa modifica, qualunque sia la transizione
            // (da saldare -> paid, cambio data, aggiunta nota, ecc.).
            logger.log('[Save] Booking gia\' confermato in precedenza — salto reinvio conferma.')
            templateKey = null
          } else if ((confirmBooking && isPending) || isPayByLinkPending) {
            // Prima conferma "Da Saldare" — checkbox Conferma OPPURE
            // Pay-by-Link automatica (deve sempre confermare il booking
            // cliente, il link pagamento parte separato dopo).
            templateKey = 'booking_confirmed_da_saldare'
          } else if (confirmBooking) {
            // Prima conferma con pagamento gia' registrato.
            templateKey = 'rental_new_customer'
          } else if (isPending) {
            logger.log('[Save] Booking pending senza Conferma Prenotazione — niente conferma WhatsApp.')
            templateKey = null
          } else if (editingId) {
            // Edit di booking gia' pagato ma MAI confermato in precedenza
            // (es. l'admin aveva creato senza spuntare Conferma e ora la
            // sta spuntando per la prima volta).
            templateKey = 'rental_new_customer'
          } else {
            // Nuova prenotazione gia' pagata (senza checkbox conferma).
            templateKey = 'rental_new_customer'
          }

          if (templateKey) {
            const finalTemplateKey = templateKey
            fetch('/.netlify/functions/send-whatsapp-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customPhone: custPhone,
                booking: {
                  id: insertedBooking?.id || editingId || null,
                  service_type: (insertedBooking as { service_type?: string } | null)?.service_type || 'car_rental',
                },
                templateKey: finalTemplateKey,
                templateVars,
              })
            }).then(() => logger.log(`✅ Customer WhatsApp sent (${finalTemplateKey}) to`, custPhone))
              .catch(err => console.error('⚠️ Customer WhatsApp failed:', err))
          }

          // Per-payment-method receipt event — fires IN ADDITION to the
          // conferma above when admin saves a paid booking with Conferma
          // Prenotazione ticked. Admin can have a dedicated template per
          // method (Pagato Contanti, Pagato Carta, ...) by ticking the
          // matching event in the template's handled_events. If no template
          // claims the event, the send silently skips (no fallback).
          //
          // Anti-duplicato: parte SOLO se il pagamento e' appena diventato
          // paid (transition pending -> paid) OPPURE se e' una prenotazione
          // nuova creata direttamente paid. Su edit di una booking gia'
          // pagata al momento del load, NON ririlascia il "Pagamento ricevuto".
          const prevPaymentStatusForMethod = String(editFormSnapshotRef.current?.payment_status || '').toLowerCase()
          const prevWasPaidAtLoad = ['paid', 'succeeded', 'completed'].includes(prevPaymentStatusForMethod)
          const justTransitionedToPaid = !editingId || !prevWasPaidAtLoad
          if (confirmBooking && !isPending && justTransitionedToPaid) {
            const pm = String(formData.payment_method || '').toLowerCase().trim()
            let methodEvent: string | null = null
            if (pm.includes('contanti') || pm === 'cash' || pm === 'prepagata') methodEvent = 'booking_paid_cash'
            else if (pm.includes('carta') || pm.includes('bancomat') || pm === 'pos') methodEvent = 'booking_paid_card'
            else if (pm.includes('bonifico') || pm.includes('sepa')) methodEvent = 'booking_paid_bank_transfer'
            else if (pm === 'paypal') methodEvent = 'booking_paid_paypal'
            else if (pm.includes('wallet') || pm === 'credit wallet') methodEvent = 'booking_paid_wallet'

            if (methodEvent) {
              const finalMethodEvent = methodEvent
              fetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  customPhone: custPhone,
                  booking: {
                    id: insertedBooking?.id || editingId || null,
                    service_type: (insertedBooking as { service_type?: string } | null)?.service_type || 'car_rental',
                  },
                  templateKey: finalMethodEvent,
                  templateVars,
                })
              }).then(() => logger.log(`✅ Per-method WhatsApp sent (${finalMethodEvent}) to`, custPhone))
                .catch(err => console.error(`⚠️ Per-method WhatsApp (${finalMethodEvent}) failed:`, err))
            }
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

      // Auto-generate fattura when payment status is "paid". Skip if the
      // payment method has auto_invoice=false in Centralina Pro > Fiscale
      // (admin-managed). Skip on edit if payment was ALREADY paid before.
      const autoInvoice = await paymentMethodAutoInvoice(formData.payment_method)
      const shouldGenerateFattura = formData.payment_status === 'paid'
        && insertedBooking?.id
        && autoInvoice
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
            // 200 OK puo' essere "fattura creata" OPPURE "fattura saltata"
            // (skipped: true) — wallet/gift card, importo €0, gia' esistente.
            // Niente toast quando saltata, altrimenti l'admin pensa che la
            // fattura sia stata creata davvero.
            const okJson = await invoiceRes.clone().json().catch(() => null) as { skipped?: boolean; message?: string; invoice?: { numero_fattura?: string } } | null
            if (okJson?.skipped) {
              logger.log('[Auto-Gen] Fattura saltata:', okJson.message || '(no message)')
              // No toast — la booking e' stata salvata, basta la conferma di salvataggio
            } else {
              logger.log('[Auto-Gen] ✅ Fattura generated and sent to SDI')
              const numero = okJson?.invoice?.numero_fattura
              toast.success(numero ? `Fattura ${numero} generata` : 'Fattura generata', { duration: 3000 })
            }
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

      // DR7 Privilege noleggio — fire-and-forget quando il booking diventa
      // "paid" da Modifica → Salva. Backend (utils/dr7Privilege) e'
      // idempotente via dr7_privilege_sent_at, quindi se UnpaidBookingsTab
      // o CarWashBookingsTab triggerano dopo, il backend ignora il duplicato.
      const shouldFirePrivilege = formData.payment_status === 'paid'
        && insertedBooking?.id
        && (!editingId || justMarkedPaid)
      if (shouldFirePrivilege) {
        authFetch('/.netlify/functions/trigger-dr7-privilege', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: insertedBooking.id, kind: 'noleggio' }),
        }).catch(() => { /* non-blocking */ })
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
                    booking: {
                      id: insertedBooking.id,
                      service_type: insertedBooking.service_type || 'car_rental',
                    },
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
      // Cases that trigger:
      //   - formData.payment_status ∈ {paid, completed, succeeded}
      //       → new paid booking, or edit that stays paid, or transition to paid.
      //   - Edit of a PREVIOUSLY paid booking (even if admin now saves as
      //     Da Saldare to ask for more money): the original customer already
      //     signed the old terms, so they need the updated contract. The
      //     pay-by-link handles the additional payment separately.
      // Cases that DON'T trigger:
      //   - New Da Saldare booking (customer has never paid, not confirmed).
      //   - Edit with an outstanding balance (defer until customer pays delta).
      //   - Conferma Prenotazione ticked su pending booking: il contratto
      //     parte SOLO dopo il pagamento effettivo (non basta confermare
      //     la prenotazione). 2026-05-19: rimosso confirmBooking dalla
      //     condizione perché direzione vuole il contratto post-pagamento.
      //     Il pay-by-link callback (nexi-payment-callback.ts) farà partire
      //     il contratto quando il pagamento arriva davvero.
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
    editFormSnapshotRef.current = null
    setTotalLock(false)
    // 2026-05-18: pulizia stato OTP residuo per evitare auto-resume su
    // form fresca dopo una sessione di approvazioni.
    pendingSubmitRef.current = null
    comboExtraCodesRef.current = []
    comboMessageRef.current = ''
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
      km_package_id: '',
      km_package_qty: 1,
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
      km_packages: {},
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
        {/* Premium dashboard header: title + KPI stat cards */}
        <ReservationsDashboardHeader
          bookings={bookings}
          onNewBooking={() => { resetForm(); setEditingId(null); newSession('booking_create'); setShowForm(true) }}
        />

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

        {/* Limitation Override Modal (OTP director approval).
            showNotes: campo note operatore opzionale, mostrato per tutti i
            gate Salva-time. Se compilato il testo arriva nell'email a
            direzione e nel log attività. */}
        <LimitationOverrideModal
          isOpen={limitationState.isOpen}
          limitationCode={limitationState.limitationCode}
          limitationMessage={limitationState.limitationMessage}
          actionContext={limitationState.actionContext}
          draftSessionId={draftSessionId}
          flowType={flowType}
          details={
            // Mostriamo i dettagli per OGNI gate OTP cosi' la direzione
            // vede sempre cliente / veicolo / date / importi nella mail.
            // Se il flusso ha gia' settato overrideDetails (combo Salva,
            // gate driver, gate slot) usiamo quelli; altrimenti
            // costruiamo al volo le righe base dallo stato corrente.
            limitationState.isOpen
              ? (overrideDetails && overrideDetails.length > 0
                  ? overrideDetails
                  : buildOverrideDetailsBase([
                      { label: 'Motivo richiesta', value: limitationState.limitationMessage || '' },
                    ]))
              : undefined
          }
          showNotes={[
            'paid_rental_modify',
            'out_of_office_hours',
            'tier1_no_cauzione',
            'no_cauzione_rca_only',
            'driver_blocked',
          ].includes(limitationState.limitationCode)}
          onClose={closeLimitation}
          onCancel={() => {
            // X = abort save and go back to the form. The booking values the
            // operator typed stay intact; nothing is persisted.
            pendingSubmitRef.current = null
            comboExtraCodesRef.current = []
            comboMessageRef.current = ''
            setOverrideDetails(undefined)
            cancelLimitation()
          }}
          onOverrideApproved={(overrideId, notes) => {
            handleOverrideApproved(overrideId, notes)
            // Combo OTP: una sola autorizzazione copre tutti i gate scattati.
            const extras = comboExtraCodesRef.current
            if (extras.length > 0) {
              markCodesApproved(extras, overrideId, comboMessageRef.current || '')
              comboExtraCodesRef.current = []
              comboMessageRef.current = ''
            }
          }}
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
                              setOverrideDetails(buildOverrideDetailsBase([
                                { label: 'Motivo richiesta', value: `Cliente non idoneo al noleggio: ${tier.reason}` },
                                { label: 'Eta cliente', value: `${age} anni` },
                                { label: 'Anni patente', value: `${licYears} anni` },
                              ]))
                              requestOverride('driver_blocked', `Cliente non idoneo al noleggio: ${tier.reason} (Età: ${age} anni — Patente: ${licYears} anni)`)
                            }
                            if (licYears < 3 && !hasOverride('license_too_recent')) {
                              const patNum = cust?.patente || cust?.numero_patente || cust?.metadata?.patente?.numero || '—'
                              setOverrideDetails(buildOverrideDetailsBase([
                                { label: 'Motivo richiesta', value: 'Patente rilasciata da meno di 3 anni' },
                                { label: 'Numero patente', value: String(patNum) },
                                { label: 'Anni patente', value: `${licYears} anni` },
                                { label: 'Data rilascio patente', value: new Date(patenteDate).toLocaleDateString('it-IT') },
                              ]))
                              requestOverride('license_too_recent', `Patente rilasciata da meno di 3 anni (${licYears} anni). Il cliente non può noleggiare.`)
                            }

                            // Check expired license immediately
                            const scadenzaP = cust?.scadenza_patente || cust?.data_scadenza_patente || cust?.metadata?.patente?.scadenza
                            if (scadenzaP) {
                              const expDate = new Date(scadenzaP)
                              if (expDate < new Date() && !hasOverride('license_expired')) {
                                const patNum = cust?.patente || cust?.numero_patente || cust?.metadata?.patente?.numero || '—'
                                setOverrideDetails(buildOverrideDetailsBase([
                                  { label: 'Motivo richiesta', value: 'Patente scaduta' },
                                  { label: 'Numero patente', value: String(patNum) },
                                  { label: 'Scadenza patente', value: expDate.toLocaleDateString('it-IT') },
                                ]))
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
                              const patNum = cust?.patente || cust?.numero_patente || cust?.metadata?.patente?.numero || '—'
                              setOverrideDetails(buildOverrideDetailsBase([
                                { label: 'Motivo richiesta', value: 'Patente rilasciata da meno di 3 anni' },
                                { label: 'Numero patente', value: String(patNum) },
                                { label: 'Anni patente', value: `${licYears} anni` },
                                { label: 'Data rilascio patente', value: new Date(patenteDate).toLocaleDateString('it-IT') },
                              ]))
                              requestOverride('license_too_recent', `Patente rilasciata da meno di 3 anni (${licYears} anni). Il cliente non può noleggiare.`)
                            }
                          }
                        } catch (e) {
                          logger.warn('Customer tier check failed:', e)
                        }
                      }}
                      placeholder="Inizia a scrivere nome, email o telefono..."
                      required={true}
                      showCardInfoOnSelect={true}
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
                    const locConfig = LOCATIONS.find(l => l.value === loc)
                    const isDomicilio = loc === 'domicilio'
                    const isOffice = loc === 'dr7_office'
                    setFormData(prev => ({
                      ...prev,
                      pickup_location: loc,
                      delivery_enabled: !isOffice,
                      delivery_fee: isDomicilio ? prev.delivery_fee : String(locConfig?.fee ?? 0),
                      ...(loc === 'cagliari_airport' ? {
                        delivery_street: 'Aeroporto di Cagliari Elmas',
                        delivery_city: 'Elmas', delivery_zip: '09030', delivery_province: 'CA',
                      } : isOffice ? {
                        delivery_enabled: false, delivery_fee: '0',
                        delivery_street: '', delivery_city: '', delivery_zip: '', delivery_province: '',
                      } : {}),
                    }))
                  }}
                  options={LOCATIONS}
                />
                {formData.pickup_location === 'domicilio' && (
                  <div className="mt-2 space-y-2 p-3 bg-theme-bg-tertiary rounded border border-theme-border">
                    <p className="text-xs text-amber-400 font-semibold">Indirizzo di consegna (basta la città)</p>
                    <AddressAutocomplete
                      label="Indirizzo Consegna (opzionale)"
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
                    const locConfig = LOCATIONS.find(l => l.value === loc)
                    const isDomicilio = loc === 'domicilio'
                    const isOffice = loc === 'dr7_office'
                    setFormData(prev => ({
                      ...prev,
                      dropoff_location: loc,
                      pickup_enabled: !isOffice,
                      pickup_fee: isDomicilio ? prev.pickup_fee : String(locConfig?.fee ?? 0),
                      ...(loc === 'cagliari_airport' ? {
                        pickup_street: 'Aeroporto di Cagliari Elmas',
                        pickup_city: 'Elmas', pickup_zip: '09030', pickup_province: 'CA',
                      } : isOffice ? {
                        pickup_enabled: false, pickup_fee: '0',
                        pickup_street: '', pickup_city: '', pickup_zip: '', pickup_province: '',
                      } : {}),
                    }))
                  }}
                  options={LOCATIONS}
                />
                {formData.dropoff_location === 'domicilio' && (
                  <div className="mt-2 space-y-2 p-3 bg-theme-bg-tertiary rounded border border-theme-border">
                    <p className="text-xs text-amber-400 font-semibold">Indirizzo di ritiro veicolo (basta la città)</p>
                    <AddressAutocomplete
                      label="Indirizzo Ritiro (opzionale)"
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
                      const filtered = getInsuranceOptions(selectedVehicle, activeTier, configOverlay, rentalConfig)
                      const currentId = formData.insurance_option
                      const hasCurrent = !!filtered.find(o => o.id === currentId)
                      // GHOST OPTION FIX: if the stored insurance UID isn't in
                      // the filtered options (vehicle category / driver tier
                      // mismatch, or the option was renamed in Centralina Pro)
                      // we MUST still show it. Otherwise the select silently
                      // defaults to the first option (Kasko Base) and the next
                      // Save overwrites the customer's real choice. Lookup the
                      // label across ALL Pro insurance options.
                      const ghostLabel = !hasCurrent && currentId
                        ? (getInsuranceNameById(rentalConfig as any, currentId) || currentId)
                        : null
                      return (
                        <>
                          {ghostLabel && (
                            <option key={`__ghost__${currentId}`} value={currentId}>
                              {ghostLabel} (salvata in prenotazione)
                            </option>
                          )}
                          {filtered.map(opt => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label} {opt.pricePerDay > 0 ? `(€${opt.pricePerDay}/giorno)` : '(inclusa)'}
                            </option>
                          ))}
                        </>
                      )
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
                          {isNoDepositOpt(selectedDepositOption)
                            ? 'Senza cauzione'
                            : `Importo: €${Number(selectedDepositOption.amount || 0).toLocaleString('it-IT')}`}
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
                          // When switching to "No Cauzione", realign deposit_option_id
                          // so the panel doesn't keep showing "Importo: €2.000" from
                          // the previously picked Card option. Prefer the explicit
                          // no_deposit option from Centralina if present; otherwise
                          // clear the option id entirely.
                          const noDepOpt = depositOptionsForCurrentBooking.find(o => isNoDepositOpt(o));
                          setFormData(prev => ({
                            ...prev,
                            deposit_status: val,
                            ...(val === 'no_cauzione'
                              ? { deposit: '0', deposit_option_id: noDepOpt?.id || '' }
                              : (prev.deposit_option_id && depositOptionsForCurrentBooking.find(o => o.id === prev.deposit_option_id && isNoDepositOpt(o))
                                  ? { deposit_option_id: '' }
                                  : {})),
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

            {/* Home Delivery / Pickup — UI rimossa per allinearsi a
                PreventiviTab: l'unica entry point e' selezionare
                "Consegna a domicilio" / "Ritiro a domicilio" nei dropdown
                Luogo Ritiro / Luogo Riconsegna, che gia' aprono il pannello
                indirizzo + fee dedicato (lines 7022+ / 7110+). Niente
                doppio checkbox confondente. Sezione Home Pickup sotto e'
                anche rimossa. */}

            {/* Home Pickup UI rimossa per allinearsi a PreventiviTab —
                vedi nota sopra. */}

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
                      + eurToCents(formData.delivery_fee || '0')
                      + eurToCents(formData.pickup_fee || '0')
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
                      : (isNexiPayByLink(formData.payment_method) ? 'pending' : 'confirmed'),
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
                    // 2026-05-22: auto-reset a pending SOLO se l'admin
                    // non ha gia' selezionato un payment_status esplicito
                    // diverso da pending. Cosi' "Pagato" + "Nexi Pay by
                    // Link" (es. cliente ha gia' pagato via link manualmente
                    // o via POS Nexi) NON forza il booking a pending.
                    // Match anche label "Nexi - Pay by Link" via matcher
                    // tollerante (era hardcoded a "Nexi Pay by Link" → mai matchava).
                    if (isNexiPayByLink(method)
                        && formData.payment_status !== 'paid'
                        && formData.payment_status !== 'partial') {
                      updates.payment_status = 'pending'
                      updates.status = 'pending'
                      updates.amount_paid = '0'
                    }
                    setFormData(prev => ({ ...prev, ...updates }))
                  }}
                  options={(() => {
                    const opts = paymentMethods.map(pm => ({ value: pm.label, label: pm.label }))
                    // Keep legacy value visible if it's not in the curated list
                    if (formData.payment_method && !opts.some(o => o.value === formData.payment_method)) {
                      opts.push({ value: formData.payment_method, label: formData.payment_method })
                    }
                    return opts
                  })()}
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
                          const deliveryFees = (parseFloat(formData.delivery_fee || '0') || 0)
                            + (parseFloat(formData.pickup_fee || '0') || 0)
                          const dpSurchargePerDay = selectedDepositSurchargePerDay
                            || (formData.deposit_status === 'no_cauzione' ? CFG_NO_CAUZIONE_PER_DAY : 0)
                          const noCauzioneCost = dpSurchargePerDay * revenueSuggestion.rentalDays
                          const unlimitedKmCost = formData.unlimited_km
                            ? getUnlimitedKmPriceRes(sv, activeTier) * revenueSuggestion.rentalDays : 0
                          const secondDriverCost = formData.has_second_driver
                            ? (activeTier === 'TIER_2' ? CFG_SECOND_DRIVER.TIER_2 : CFG_SECOND_DRIVER.TIER_1) * revenueSuggestion.rentalDays : 0
                          const experienceCost = calculateExperienceCost(formData.experience_services, revenueSuggestion.rentalDays)
                          const flexCost = formData.dr7_flex && activeTier === 'TIER_2' ? CFG_DR7_FLEX_PER_DAY * revenueSuggestion.rentalDays : 0
                          // Pacchetti KM (multi-select cumulativo). Passthrough, fuori coefficiente.
                          const kmPackagesCost = (() => {
                            const kmPkgs = (formData.km_packages || {}) as Record<string, number>
                            if (!kmPkgs || Object.keys(kmPkgs).length === 0) return 0
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const pkgsByCat = (rentalConfig as any)?.pacchetti_km as Record<string, Array<{ id: string; price: number }>> | undefined
                            const catPkgs = resolvePacchetti(sv?.category, pkgsByCat)
                            if (catPkgs.length === 0) return 0
                            let sum = 0
                            for (const pkg of catPkgs) {
                              const q = Number(kmPkgs[pkg.id]) || 0
                              if (q > 0) sum += Number(pkg.price || 0) * q
                            }
                            return Math.round(sum * 100) / 100
                          })()
                          // List price (no coefficients). Experience AND location
                          // fees (consegna + ritiro) excluded from the
                          // clamp-eligible subtotal — devono restare a listino,
                          // stesso trattamento dell'auto-fill (riga 981) e di
                          // Preventivi. Mostrare il coefficiente come applicato
                          // anche su consegna/ritiro confonde l'admin: lo sconto
                          // visualizzato non corrisponderebbe al totale salvato.
                          const listDailyRate = revenueSuggestion.selectedBaseRateEur || getDailyRateFromConfig(sv, revenueSuggestion.rentalDays)
                          const listRentalTotal = listDailyRate * revenueSuggestion.rentalDays
                          const listSubtotalNoExp = listRentalTotal + insTotal + CFG_LAVAGGIO_FEE + noCauzioneCost + unlimitedKmCost + secondDriverCost + flexCost
                          const listSubtotal = listSubtotalNoExp + experienceCost + deliveryFees + kmPackagesCost
                          const combinedCoeff = (revenueSuggestion.breakdown || []).reduce((acc: number, b: { coeff: number }) => acc * b.coeff, 1)
                          const rawAfterCoeffNoExp = listSubtotalNoExp * combinedCoeff
                          // Experience + location fees stay at LIST PRICE — no
                          // coefficient, no clamp. Min/Max clamp on the no-exp,
                          // no-fees subtotal only.
                          const minDaily = typeof revenueSuggestion.minPrice === 'number' ? revenueSuggestion.minPrice : null
                          const maxDaily = typeof revenueSuggestion.maxPrice === 'number' ? revenueSuggestion.maxPrice : null
                          const maxTotal = maxDaily != null ? maxDaily * revenueSuggestion.rentalDays : null
                          const minTotal = minDaily != null ? minDaily * revenueSuggestion.rentalDays : null
                          let clampedNoExp = rawAfterCoeffNoExp
                          let clampHit: 'min' | 'max' | null = null
                          if (maxTotal != null && clampedNoExp > maxTotal) { clampedNoExp = maxTotal; clampHit = 'max' }
                          if (minTotal != null && clampedNoExp < minTotal) { clampedNoExp = minTotal; clampHit = 'min' }
                          const uncappedSubtotal = Math.round((rawAfterCoeffNoExp + experienceCost + deliveryFees + kmPackagesCost) * 100) / 100
                          const dynamicSubtotal = Math.round((clampedNoExp + experienceCost + deliveryFees + kmPackagesCost) * 100) / 100
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
                {/* DR7 FLEX rimosso come addon dedicato — ora è un servizio
                    in EXPERIENCE_SERVICES via Centralina Pro. */}
              </div>

              <Input
                label="Importo Totale (€)"
                type="number"
                step="0.01"
                required
                value={formData.total_amount}
                onChange={(e) => {
                  const newTotal = e.target.value
                  // 2026-05-18: admin sta digitando il totale a mano → blocca
                  // i recalc effects dall'overridarlo (consegna/ritiro/pacchetti
                  // non possono piu' modificare il totale dopo questa azione).
                  setTotalLock(true)
                  setFormData(prev => {
                    // 2026-05-18: total_amount include GIA' delivery + pickup nel
                    // recalc; ora che admin lo decide a mano, prendiamo newTotal
                    // come VERITA' assoluta. amount_paid = newTotal (no doppi).
                    const newPaid = prev.payment_status === 'paid' ? newTotal : prev.amount_paid
                    return { ...prev, total_amount: newTotal, amount_paid: newPaid }
                  })
                }}
              />
              {totalAmountManuallyOverriddenRef.current && (
                <p className="text-xs text-amber-400 mt-1">
                  Importo bloccato — modifiche a consegna/ritiro/pacchetti non lo cambieranno piu'.
                  <button type="button" className="ml-2 underline text-dr7-gold"
                    onClick={() => setTotalLock(false)}>
                    Sblocca ricalcolo automatico
                  </button>
                </p>
              )}
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
                  if (!cfgSforo || Number(cfgSforo) <= 0) return null
                  // BUG FIX 2026-05-16 (v2): legge la label da vehicle_categories
                  // con alias supercars↔exotic. Prima il fix v1 leggeva
                  // direttamente vehicle_categories[catId] ma convertProConfig
                  // scrive sotto chiave 'exotic' quando Pro id e' 'supercars'
                  // (mapping PRO_TO_DB_CATEGORY). Quindi per Lamborghini
                  // (category='supercars') la chiave era 'exotic' → label
                  // non trovata → si mostrava il raw id "supercars". Fix:
                  // alias come negli altri lookup category.
                  const _svCat = (sv?.category as string | undefined) || ''
                  const aliases = _svCat === 'supercars' ? ['supercars', 'exotic']
                    : _svCat === 'exotic' ? ['exotic', 'supercars']
                    : _svCat ? [_svCat] : []
                  let fromConfig = ''
                  for (const k of aliases) {
                    const found = rentalConfig?.vehicle_categories?.[k]?.label
                    if (found) { fromConfig = found; break }
                  }
                  const catLabel = fromConfig || _svCat
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

              {/* === PACCHETTI KM (2026-05-16) ===
                  Pacchetti extra acquistabili per la categoria del veicolo
                  selezionato. Letti da rentalConfig.pacchetti_km (popolato da
                  convertProConfig). Mutuamente esclusivi con KM Illimitati.
                  Cliccando una card → seleziona/deseleziona il pacchetto. */}
              {(() => {
                const selVeh = vehicles.find(v => v.id === formData.vehicle_id)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const pkgsByCat = (rentalConfig as any)?.pacchetti_km as Record<string, Array<{ id: string; km: number; sconto_pct: number; price: number; label: string }>> | undefined
                if (!selVeh) {
                  return (
                    <div className="mt-2 p-3 rounded-md border border-dashed border-theme-border bg-theme-bg-tertiary/30 text-xs text-theme-text-muted">
                      Seleziona prima un veicolo per vedere i pacchetti KM disponibili.
                    </div>
                  )
                }
                const cat = String(selVeh.category || '').toLowerCase().trim()
                if (!cat) return null
                if (!pkgsByCat) {
                  return (
                    <div className="mt-2 p-3 rounded-md border border-dashed border-theme-border bg-theme-bg-tertiary/30 text-xs text-theme-text-muted">
                      Nessun pacchetto KM configurato. Vai in Centralina Pro {'>'} KM per aggiungerli.
                    </div>
                  )
                }
                const pkgs = resolvePacchetti(cat, pkgsByCat)
                if (pkgs.length === 0) {
                  return (
                    <div className="mt-2 p-3 rounded-md border border-dashed border-theme-border bg-theme-bg-tertiary/30 text-xs text-theme-text-muted">
                      Nessun pacchetto KM per la categoria <b>{cat}</b>. Aggiungili da Centralina Pro {'>'} KM {'>'} {cat}.
                    </div>
                  )
                }
                return (
                  <div className="space-y-2 mt-2">
                    <h4 className="text-xs font-semibold text-theme-text-muted uppercase tracking-wider">Pacchetti KM extra (cumulativi)</h4>
                    {pkgs.map(pkg => {
                      // 2026-05-16: multi-select cumulativo. Ogni pacchetto ha
                      // qty indipendente in formData.km_packages.
                      const isDisabled = formData.unlimited_km
                      const isQtyBuyable = !!(pkg as { is_quantity_buyable?: boolean }).is_quantity_buyable
                      const maxQty = isQtyBuyable ? Math.max(1, Number((pkg as { max_quantity?: number }).max_quantity) || 2) : 1
                      const qty = formData.km_packages?.[pkg.id] || 0
                      const isSelected = qty > 0
                      const setQty = (q: number) => {
                        const clamped = Math.max(0, Math.min(maxQty, q))
                        setFormData(prev => {
                          const next = { ...(prev.km_packages || {}) }
                          if (clamped === 0) delete next[pkg.id]
                          else next[pkg.id] = clamped
                          return { ...prev, km_packages: next }
                        })
                      }
                      return (
                        <div key={pkg.id}
                          onClick={() => { if (!isSelected && !isDisabled) setQty(1) }}
                          className={`p-3 rounded-md border transition-colors ${
                            isDisabled ? 'opacity-50 cursor-not-allowed border-theme-border'
                            : isSelected ? 'border-dr7-gold bg-dr7-gold/10'
                            : 'border-theme-border hover:border-theme-text-muted cursor-pointer'
                          }`}
                        >
                          <div className="flex justify-between items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold text-theme-text-primary">{pkg.label} <span className="text-theme-text-muted font-normal">({pkg.km} km)</span></div>
                              {pkg.sconto_pct > 0 && (
                                <div className="text-xs text-theme-text-muted">Sconto {pkg.sconto_pct}% sul sforo</div>
                              )}
                              {isQtyBuyable && !isSelected && (
                                <div className="text-xs text-dr7-gold mt-0.5">+ Aggiungi più volte (max {maxQty})</div>
                              )}
                              {isSelected && qty > 1 && (
                                <div className="text-xs text-dr7-gold font-medium">Totale: {qty * pkg.km} km — €{(pkg.price * qty).toFixed(2)}</div>
                              )}
                            </div>
                            {isSelected ? (
                              <div className="flex items-center gap-2">
                                <button type="button" disabled={isDisabled} onClick={(e) => { e.stopPropagation(); setQty(qty - 1) }}
                                  className="w-7 h-7 rounded-full bg-theme-bg-tertiary border border-theme-border text-theme-text-primary font-bold disabled:opacity-50">−</button>
                                <span className="text-sm font-bold text-theme-text-primary min-w-[1.5rem] text-center">{qty}</span>
                                <button type="button" disabled={isDisabled || qty >= maxQty} onClick={(e) => { e.stopPropagation(); setQty(qty + 1) }}
                                  className="w-7 h-7 rounded-full bg-dr7-gold !text-white font-bold disabled:opacity-50">+</button>
                                <span className="text-sm font-bold text-dr7-gold ml-2">€{(pkg.price * qty).toFixed(2)}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-dr7-gold">+€{pkg.price.toFixed(2)}</span>
                                <button type="button" disabled={isDisabled} onClick={(e) => { e.stopPropagation(); setQty(1) }}
                                  className="w-7 h-7 rounded-full bg-dr7-gold !text-white font-bold disabled:opacity-50">+</button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

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

            {/* Riepilogo Totale - shows breakdown with delivery/pickup fees + KM packages.
                2026-05-18: total_amount include GIA' consegna + ritiro + pacchetti
                (sommati dal recalc effect). Quindi il "Totale da saldare" e' SEMPLICEMENTE
                total_amount — non aggiungiamo piu' delivery/pickup sopra (bug double-count).
                Le righe Consegna/Ritiro/Pacchetti sono SOLO una decomposizione di total_amount,
                con "Noleggio base" = total_amount - tutti gli extra elencati. */}
            {(() => {
              const selVeh = vehicles.find(v => v.id === formData.vehicle_id)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const pkgsByCat = (rentalConfig as any)?.pacchetti_km as Record<string, Array<{ id: string; price: number; label?: string; km?: number }>> | undefined
              const catPkgs = pkgsByCat ? resolvePacchetti(selVeh?.category, pkgsByCat) : []
              const kmEntries: Array<{ id: string; qty: number; price: number; label: string; km?: number }> = []
              let kmPackagesCost = 0
              const kmMap = (formData.km_packages || {}) as Record<string, number>
              for (const [pkgId, q] of Object.entries(kmMap)) {
                const qty = Number(q) || 0
                if (qty <= 0) continue
                const pkg = catPkgs.find(p => p.id === pkgId)
                if (!pkg) continue
                const price = Number(pkg.price) || 0
                kmEntries.push({ id: pkgId, qty, price, label: (pkg as { label?: string }).label || pkgId, km: (pkg as { km?: number }).km })
                kmPackagesCost += price * qty
              }
              const showRiepilogo = formData.delivery_enabled || formData.pickup_enabled || kmEntries.length > 0
              if (!showRiepilogo) return null
              const totalAmountCents = eurToCents(formData.total_amount || '0')
              const deliveryCents = formData.delivery_enabled ? eurToCents(formData.delivery_fee || '0') : 0
              const pickupCents = formData.pickup_enabled ? eurToCents(formData.pickup_fee || '0') : 0
              const kmCostCents = Math.round(kmPackagesCost * 100)
              // Noleggio base = total - tutti gli extra mostrati come righe sotto.
              const baseCents = Math.max(0, totalAmountCents - kmCostCents - deliveryCents - pickupCents)
              return (
                <div className="md:col-span-2 bg-theme-text-primary/5 rounded-lg p-4 border border-theme-border/50">
                  <h4 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider mb-3">Riepilogo Totale</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-theme-text-muted">Noleggio base</span>
                      <span className="font-mono text-theme-text-primary">€{centsToEurStr(baseCents)}</span>
                    </div>
                    {kmEntries.map(e => (
                      <div key={`riepilogo-km-${e.id}`} className="flex justify-between items-center">
                        <span className="text-theme-text-muted">
                          {e.label}{e.qty > 1 ? ` x${e.qty}` : ''}{typeof e.km === 'number' ? ` (${e.km * e.qty} km)` : ''}
                        </span>
                        <span className="font-mono text-theme-text-primary">€{centsToEurStr(Math.round(e.price * e.qty * 100))}</span>
                      </div>
                    ))}
                    {formData.delivery_enabled && (
                      <div className="flex justify-between items-center">
                        <span className="text-theme-text-muted">Consegna a domicilio</span>
                        <span className="font-mono text-theme-text-primary">€{centsToEurStr(deliveryCents)}</span>
                      </div>
                    )}
                    {formData.pickup_enabled && (
                      <div className="flex justify-between items-center">
                        <span className="text-theme-text-muted">Ritiro a domicilio</span>
                        <span className="font-mono text-theme-text-primary">€{centsToEurStr(pickupCents)}</span>
                      </div>
                    )}
                    <div className="border-t border-theme-border/50 pt-2 mt-2">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-dr7-gold">Totale da saldare</span>
                        <span className="font-mono text-xl font-bold text-dr7-gold">
                          €{centsToEurStr(totalAmountCents)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

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
                    <div className="font-semibold text-theme-text-primary mb-1 flex items-center gap-1.5 flex-wrap">
                      <span>{booking.booking_details?.customer?.fullName || booking.customer_name || 'N/A'}</span>
                      <ClientStatusBadge
                        userId={booking.user_id}
                        email={booking.customer_email || booking.booking_details?.customer?.email}
                      />
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

                <div className="flex justify-between items-center mt-3 gap-2" onClick={(e) => e.stopPropagation()}>
                  <div className="text-lg font-bold text-theme-text-primary">
                    {canViewFinancials || userEmail === 'dubai.rent7.0srl@gmail.com' ? `€${(booking.price_total / 100).toFixed(2)}` : '***'}
                  </div>
                  {(() => {
                    const isPaid = booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded'
                    const hasContract = !!(booking.booking_details?.contract_generated_at || booking.contract_url)
                    const sections: GestisciSection[] = [
                      {
                        title: 'Gestione',
                        actions: [
                          { label: 'Modifica', onClick: () => handleEditBooking(booking) },
                          { label: 'Estendi', onClick: () => handleExtendBooking(booking), visible: !isCarWash },
                          { label: 'Cancella', onClick: () => handleDeleteBooking(booking.id, 'booking') },
                        ],
                      },
                      {
                        title: 'Documenti',
                        actions: [
                          {
                            label: hasContract ? 'Visualizza Contratto' : (generatingContract ? 'Generazione...' : 'Genera Contratto'),
                            onClick: () => { if (booking.contract_url) { window.open(booking.contract_url, '_blank') } else { handleGenerateContract(booking) } },
                            disabled: !hasContract && generatingContract,
                          },
                          { label: 'Invia Contratto', onClick: () => handleResendContract(booking), visible: hasContract },
                          { label: generatingInvoice ? 'Generazione...' : 'Genera Fattura', onClick: () => handleGenerateInvoice(booking), disabled: generatingInvoice },
                        ],
                      },
                      {
                        title: 'Pagamenti',
                        actions: [
                          {
                            label: booking.booking_details?.nexi_payment_link ? 'Rinvia Link Pagamento' : 'Genera Link Pagamento',
                            onClick: () => handleResendPaymentLink(booking),
                            visible: !isPaid,
                          },
                        ],
                      },
                      {
                        title: 'Altro',
                        actions: [
                          { label: 'Danni & Penali', onClick: () => { setSelectedBookingForDanniPenali(booking); setDanniPenaliInitialTab('danni'); setDanniPenaliModalOpen(true) } },
                        ],
                      },
                    ]
                    return <GestisciMenu sections={sections} size="md" />
                  })()}
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
                  <th className="px-3 py-3 text-left text-sm font-semibold text-theme-text-secondary whitespace-nowrap">Stato</th>
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
                  const isCancelled = booking.status === 'cancelled' || booking.status === 'annullata'
                  return (
                    <tr
                      key={`booking-${booking.id}`}
                      className={`border-t border-theme-border cursor-pointer ${
                        isCancelled
                          ? 'bg-red-500/10 hover:bg-red-500/15 text-red-300'
                          : 'hover:bg-theme-bg-tertiary/30'
                      }`}
                      title={isCancelled ? 'Prenotazione annullata' : undefined}
                      onClick={() => setSelectedBooking(booking)}
                    >
                      <td className="px-3 py-3 text-sm text-theme-text-primary max-w-[180px]" title={booking.booking_details?.customer?.fullName || booking.customer_name || 'N/A'}>
                        <span className="truncate">{booking.booking_details?.customer?.fullName || booking.customer_name || 'N/A'}</span>
                      </td>
                      <td className="px-3 py-3 text-sm whitespace-nowrap">
                        <ClientStatusBadge
                          userId={booking.user_id}
                          email={booking.customer_email || booking.booking_details?.customer?.email}
                        />
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
                      <td className="px-3 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const isPaid = booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded'
                          const sections: GestisciSection[] = [
                            {
                              title: 'Gestione',
                              actions: [
                                { label: 'Modifica', onClick: () => handleEditBooking(booking), visible: booking.status !== 'cancelled' },
                                { label: 'Estendi', onClick: () => handleExtendBooking(booking), visible: booking.status !== 'cancelled' && !isCarWash },
                                { label: 'Cancella', onClick: () => handleDeleteBooking(booking.id, 'booking'), visible: booking.status !== 'cancelled' },
                              ],
                            },
                            {
                              title: 'Documenti',
                              actions: [
                                {
                                  label: booking.contract_url ? 'Visualizza Contratto' : (generatingContract ? 'Generazione...' : 'Genera Contratto'),
                                  onClick: () => { if (booking.contract_url) { window.open(booking.contract_url, '_blank') } else { handleGenerateContract(booking) } },
                                  disabled: !booking.contract_url && generatingContract,
                                  visible: booking.status !== 'cancelled',
                                },
                                {
                                  label: 'Invia Contratto',
                                  onClick: () => handleResendContract(booking),
                                  visible: booking.status !== 'cancelled' && !!booking.contract_url,
                                },
                                {
                                  label: generatingInvoice ? 'Generazione...' : 'Genera Fattura',
                                  onClick: () => handleGenerateInvoice(booking),
                                  disabled: generatingInvoice,
                                  visible: booking.status !== 'cancelled',
                                },
                              ],
                            },
                            {
                              title: 'Pagamenti',
                              actions: [
                                {
                                  label: booking.booking_details?.nexi_payment_link ? 'Rinvia Link Pagamento' : 'Genera Link Pagamento',
                                  onClick: () => handleResendPaymentLink(booking),
                                  visible: booking.status !== 'cancelled' && !isPaid,
                                },
                              ],
                            },
                            {
                              title: 'Altro',
                              actions: [
                                {
                                  label: 'Danni & Penali',
                                  onClick: () => { setSelectedBookingForDanniPenali(booking); setDanniPenaliInitialTab('danni'); setDanniPenaliModalOpen(true) },
                                },
                              ],
                            },
                          ]
                          return <GestisciMenu sections={sections} size="sm" />
                        })()}
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
                        <div><span className="text-theme-text-muted">Assicurazione:</span> <span className="text-dr7-gold">{(() => {
                          const rawId = selectedBooking.booking_details?.insuranceOption || ''
                          const proName = getInsuranceNameById(rentalConfig, rawId)
                          if (proName) return proName
                          const legacyMap: Record<string, string> = {
                            RCA: 'RCA Compresa (no Kasko)',
                            KASKO: 'Kasko Base',
                            KASKO_BASE: 'Kasko Base',
                            KASKO_BLACK: 'Kasko Black',
                            KASKO_SIGNATURE: 'Kasko Signature',
                            KASKO_DR7: 'Kasko DR7',
                            DR7: 'Kasko DR7',
                          }
                          return legacyMap[rawId] || rawId || 'Kasko Base'
                        })()}</span></div>
                        <div><span className="text-theme-text-muted">Cauzione:</span> <span className="text-theme-text-primary">{
                          selectedBooking.booking_details?.depositOption === 'no_deposit'
                            ? `Senza cauzione (+30% = €${selectedBooking.booking_details?.noDepositSurcharge?.toFixed(2) || '0.00'})`
                            : (selectedBooking.deposit_amount || selectedBooking.booking_details?.deposit)
                              ? `€${selectedBooking.deposit_amount || selectedBooking.booking_details?.deposit}`
                              : 'N/A'
                        }</span></div>
                        <div><span className="text-theme-text-muted">KM:</span> <span className="text-theme-text-primary">{(() => {
                          const bd = selectedBooking.booking_details as Record<string, unknown> | undefined;
                          const isUnlimitedFlag = bd?.unlimited_km === true
                            || bd?.km_limit === 'Illimitati'
                            || (bd?.kmPackage as { type?: string } | undefined)?.type === 'unlimited'
                            || Number((bd?.kmPackage as { includedKm?: number } | undefined)?.includedKm) >= 9999;
                          if (isUnlimitedFlag) return 'KM Illimitati';
                          const rawLimit = bd?.km_limit as string | number | undefined;
                          const perDayMatch = typeof rawLimit === 'string' ? rawLimit.match(/^(\d+)\/giorno$/) : null;
                          if (perDayMatch && selectedBooking.pickup_date && selectedBooking.dropoff_date) {
                            const kmPerDay = parseInt(perDayMatch[1]);
                            const days = Math.ceil((new Date(selectedBooking.dropoff_date).getTime() - new Date(selectedBooking.pickup_date).getTime()) / (1000 * 60 * 60 * 24));
                            return `${kmPerDay * days} Km (${kmPerDay}/g x ${days}gg)`;
                          }
                          const numLimit = typeof rawLimit === 'string' ? parseInt(rawLimit, 10) : (typeof rawLimit === 'number' ? rawLimit : NaN);
                          if (Number.isFinite(numLimit) && numLimit > 0) return `${numLimit} km`;
                          const pkgKm = Number((bd?.kmPackage as { includedKm?: number } | undefined)?.includedKm);
                          if (Number.isFinite(pkgKm) && pkgKm > 0) return `${pkgKm} km`;
                          const pkgsTotal = Array.isArray(bd?.km_packages)
                            ? (bd?.km_packages as Array<{ total_km?: number }>).reduce((s, p) => s + (Number(p?.total_km) || 0), 0)
                            : 0;
                          if (pkgsTotal > 0) return `${pkgsTotal} km`;
                          return rawLimit ? `${rawLimit} km` : 'KM Illimitati';
                        })()}</span></div>
                        {(() => {
                          const bd = selectedBooking.booking_details as Record<string, unknown> | undefined;
                          const hasFlex = bd?.dr7_flex === true
                            || (bd?.extras_detail as { flex?: boolean } | undefined)?.flex === true;
                          if (!hasFlex) return null;
                          const flexCost = Number(bd?.flex_cost) || 0;
                          return (
                            <div className="mt-2 pt-2 border-t border-theme-border/30 flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-dr7-gold/20 text-dr7-gold border border-dr7-gold/40">
                                DR7 FLEX
                              </span>
                              {flexCost > 0 && (
                                <span className="text-xs text-theme-text-muted">€{flexCost.toFixed(2)}</span>
                              )}
                              <span className="text-xs text-theme-text-muted">4 condizioni FLEX attive</span>
                            </div>
                          );
                        })()}
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

/**
 * Premium dashboard header per Prenotazioni Noleggio.
 * 4 KPI calcolate dal solo state `bookings` (nessuna nuova fetch):
 *   - Prenotazioni Totali (count rentals)
 *   - Noleggi Attivi (active/confirmed, non-cancelled, non-completed)
 *   - Fatturato MENSILE: usa prorateRevenueForMonth (stessa formula di
 *     Report Noleggio) cosi' i numeri qui combaciano con quelli del
 *     report. Include credit_wallet (gate per status, non per payment).
 *   - Scadenze (rientri oggi/scaduti ancora aperti, max 3gg passato)
 * Visivo only — non tocca query/filtri/tabella/form.
 */
function ReservationsDashboardHeader({
  bookings,
  onNewBooking,
}: {
  bookings: Booking[]
  onNewBooking: () => void
}) {
  // Default al mese corrente in Europe/Rome.
  const nowRome = new Date()
  const [selMonth, setSelMonth] = useState<{ year: number; month: number }>({
    year: nowRome.getFullYear(),
    month: nowRome.getMonth() + 1,
  })

  // 2026-05-22: leggi il fatturato CANONICO dal monthly-report endpoint
  // (stesso source di Report Noleggio + Calendario), cosi' i tre numeri
  // combaciano sempre. Local prorate resta come fallback se l'endpoint
  // non risponde.
  const [canonicalFatturato, setCanonicalFatturato] = useState<number | null>(null)
  const [canonicalBookings, setCanonicalBookings] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const yyyymm = `${selMonth.year}-${String(selMonth.month).padStart(2, '0')}`
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
    })()
    return () => { cancelled = true }
  }, [selMonth.year, selMonth.month])

  const stats = useMemo(() => {
    const now = Date.now()
    const in24h = now + 24 * 60 * 60 * 1000
    // Scadenze: 2026-05-22 finestra stretta a 24h nel passato (prima era 3gg).
    // Oltre 24h da dropoff = quasi certo status "stale" (cliente ha riconsegnato
    // ma admin non ha messo completed); contarli come "in ritardo" gonfia il KPI
    // con falsi positivi. 24h tiene solo i veri ritardi attuali.
    const grace1d = now - 24 * 60 * 60 * 1000

    const daysInSelMonth = new Date(selMonth.year, selMonth.month, 0).getDate()
    let revenueCents = 0
    // 2026-05-22: tutti i KPI in modalita' UNIQUE.
    // - total: booking unici (per id) attivi nel mese
    // - active: VEICOLI unici fuori in questo momento (non righe booking)
    // - scadenze: VEICOLI unici con rientro imminente / in ritardo
    // Se piu' righe booking puntano allo stesso veicolo (duplicati, errori),
    // contano una sola volta.
    const seenBookingIds = new Set<string>()
    const totalBookingIds = new Set<string>()
    const activeVehicles = new Set<string>()
    const ritardoVehicles = new Set<string>()
    const imminentiVehicles = new Set<string>()
    const activeStatuses = new Set(['confirmed', 'confermata', 'in_corso', 'active'])

    for (const b of bookings) {
      if (b.service_type && b.service_type !== 'rental') continue

      const bookingId = String(b.id || `${b.pickup_date}|${b.dropoff_date}|${b.vehicle_id || b.vehicle_plate}`)
      if (seenBookingIds.has(bookingId)) continue
      seenBookingIds.add(bookingId)

      const mLike = b as unknown as MonthlyBookingLike
      const reportable = isReportableRentalBooking(mLike)

      if (reportable && b.pickup_date && b.dropoff_date) {
        const overlap = getOccupiedDaysInMonth(
          b.pickup_date,
          b.dropoff_date,
          selMonth.year,
          selMonth.month,
          daysInSelMonth,
        )
        if (overlap > 0) totalBookingIds.add(bookingId)
      }

      if (reportable) {
        revenueCents += prorateRevenueForMonth(
          mLike,
          selMonth.year,
          selMonth.month,
          daysInSelMonth,
        ) * 100
      }

      const status = String(b.status || '').toLowerCase()
      if (reportable && activeStatuses.has(status)) {
        const pickupMs = b.pickup_date ? new Date(b.pickup_date).getTime() : NaN
        const dropoffMs = b.dropoff_date ? new Date(b.dropoff_date).getTime() : NaN
        const vehicleKey = String(b.vehicle_id || b.vehicle_plate || b.id || '')
        if (vehicleKey) {
          if (Number.isFinite(pickupMs) && Number.isFinite(dropoffMs) && pickupMs <= now && dropoffMs >= now) {
            activeVehicles.add(vehicleKey)
          }
          if (Number.isFinite(dropoffMs)) {
            if (dropoffMs < now && dropoffMs >= grace1d) {
              ritardoVehicles.add(vehicleKey)
            } else if (dropoffMs >= now && dropoffMs <= in24h) {
              imminentiVehicles.add(vehicleKey)
            }
          }
        }
      }
    }
    const total = totalBookingIds.size
    const active = activeVehicles.size
    const scadenzeInRitardo = ritardoVehicles.size
    const scadenzeImminenti = imminentiVehicles.size
    return {
      total,
      active,
      revenueEuro: revenueCents / 100,
      scadenzeInRitardo,
      scadenzeImminenti,
      scadenze: scadenzeInRitardo + scadenzeImminenti,
    }
  }, [bookings, selMonth])

  // Time series per i tre grafici del mese selezionato. Stessi filtri di
  // Report Noleggio. Tutti i metodi di pagamento inclusi (anche wallet)
  // perche' il gate e' per status, non per payment_status.
  const timeSeries = useMemo(() => {
    const daysInMonth = new Date(selMonth.year, selMonth.month, 0).getDate()
    const dailyRevenue: number[] = new Array(daysInMonth).fill(0)
    const dailyNewBookings: number[] = new Array(daysInMonth).fill(0)
    // Per "Auto noleggiate per giorno" usiamo set di vehicle_id per
    // contare auto distinte fuori in ciascun giorno (no double count se
    // un'auto ha due booking nello stesso giorno).
    const dailyVehicleSets: Set<string>[] = Array.from({ length: daysInMonth }, () => new Set<string>())

    for (const b of bookings) {
      if (b.service_type && b.service_type !== 'rental') continue
      const mLike = b as unknown as MonthlyBookingLike
      if (!isReportableRentalBooking(mLike)) continue
      if (!b.pickup_date || !b.dropoff_date) continue

      // Revenue per giorno = price_total / totalDays, distribuito sui
      // giorni occupati nel mese.
      const sTotalDays = (() => {
        const a = b.pickup_date.substring(0, 10).split('-').map(Number)
        const c = b.dropoff_date.substring(0, 10).split('-').map(Number)
        const aMs = Date.UTC(a[0], a[1] - 1, a[2])
        const cMs = Date.UTC(c[0], c[1] - 1, c[2])
        const diff = Math.round((cMs - aMs) / 86400000)
        return Math.max(1, diff)
      })()
      const totalCents = Number(b.price_total) || 0
      const perDayEur = (totalCents / 100) / sTotalDays

      const [pY, pM, pD] = b.pickup_date.substring(0, 10).split('-').map(Number)
      const [dY, dM, dD] = b.dropoff_date.substring(0, 10).split('-').map(Number)
      const pickupMs = Date.UTC(pY, pM - 1, pD)
      const dropoffMs = Date.UTC(dY, dM - 1, dD)
      const vehicleKey = String(b.vehicle_id || b.vehicle_plate || b.id)

      for (let day = 1; day <= daysInMonth; day++) {
        const dayMs = Date.UTC(selMonth.year, selMonth.month - 1, day)
        // Stessa regola del report: pickup day incluso, dropoff day escluso.
        // Same-day bookings (pickup === dropoff): incluso il pickup day.
        const sameDay = pickupMs === dropoffMs
        const occupies = sameDay
          ? dayMs === pickupMs
          : dayMs >= pickupMs && dayMs < dropoffMs
        if (occupies) {
          dailyRevenue[day - 1] += perDayEur
          dailyVehicleSets[day - 1].add(vehicleKey)
        }
      }

      // Nuova prenotazione: si conta nel giorno in cui e' stata creata
      // (booked_at se presente, altrimenti created_at).
      const bookedRaw = (b as { booked_at?: string }).booked_at || b.created_at
      if (bookedRaw) {
        const bd = new Date(bookedRaw)
        if (bd.getFullYear() === selMonth.year && bd.getMonth() + 1 === selMonth.month) {
          dailyNewBookings[bd.getDate() - 1]++
        }
      }
    }

    // 2026-05-22: auto UNICHE del mese (non somma auto-giorni).
    // La somma giornaliera dà numeri assurdi (es. 129 auto in flotta di ~12).
    const monthlyUniqueVehicles = new Set<string>()
    for (const set of dailyVehicleSets) {
      for (const v of set) monthlyUniqueVehicles.add(v)
    }
    return {
      daysInMonth,
      dailyRevenue,
      dailyNewBookings,
      dailyVehicles: dailyVehicleSets.map(s => s.size),
      monthlyUniqueVehicles: monthlyUniqueVehicles.size,
    }
  }, [bookings, selMonth])

  const fmtEur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
  const monthsIt = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
  const selMonthLabel = monthsIt[selMonth.month - 1]

  return (
    <div className="space-y-4 mb-2">
      {/* Title row */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-theme-text-primary tracking-tight">
            Prenotazioni Noleggio
            <span className="inline-block ml-2 w-2 h-2 rounded-full bg-green-500 align-middle animate-pulse" title="Real-time" />
          </h2>
          <p className="text-sm text-theme-text-muted mt-1">Gestisci e monitora tutte le prenotazioni</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <a
            href="?tab=calendar"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-theme-border bg-theme-bg-secondary hover:bg-theme-bg-hover text-theme-text-primary text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path strokeLinecap="round" d="M3 10h18M8 2v4M16 2v4" />
            </svg>
            <span className="hidden sm:inline">Calendario Giornaliero</span>
            <span className="sm:hidden">Calendario</span>
          </a>
          <Button onClick={onNewBooking} className="text-sm">
            <span className="hidden sm:inline">+ Nuova Prenotazione</span>
            <span className="sm:hidden">+ Nuova</span>
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={`Prenotazioni ${selMonthLabel}`}
          value={(canonicalBookings !== null ? canonicalBookings : stats.total).toLocaleString('it-IT')}
          icon={(
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path strokeLinecap="round" d="M3 10h18M8 2v4M16 2v4" />
            </svg>
          )}
          accent="cyan"
          hint="auto noleggiate nel mese"
        />
        <KpiCard
          label="Noleggi Attivi"
          value={stats.active.toLocaleString('it-IT')}
          icon={(
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <circle cx="12" cy="8" r="4" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 21c0-4 4-6 8-6s8 2 8 6" />
            </svg>
          )}
          accent="blue"
          hint="auto fuori in questo momento"
        />
        <FatturatoMonthCard
          value={fmtEur(canonicalFatturato !== null ? canonicalFatturato : stats.revenueEuro)}
          monthLabel={selMonthLabel}
          year={selMonth.year}
          month={selMonth.month}
          onChange={(y, m) => setSelMonth({ year: y, month: m })}
        />
        <KpiCard
          label="Scadenze"
          value={stats.scadenze.toLocaleString('it-IT')}
          icon={(
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86l-8.45 14.6A2 2 0 003.58 21h16.84a2 2 0 001.73-2.54l-8.45-14.6a2 2 0 00-3.46 0z" />
            </svg>
          )}
          accent="amber"
          hint={
            stats.scadenze === 0
              ? 'nessun rientro imminente'
              : `${stats.scadenzeInRitardo} in ritardo · ${stats.scadenzeImminenti} entro 24h`
          }
        />
      </div>

      {/* Time series — tre grafici allineati al picker di mese */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <TimeSeriesChart
          title={`Fatturato ${selMonthLabel}`}
          values={timeSeries.dailyRevenue}
          daysInMonth={timeSeries.daysInMonth}
          monthIndex={selMonth.month - 1}
          year={selMonth.year}
          accent="emerald"
          format={(v) => fmtEur(v)}
          formatAxis={(v) => v >= 1000 ? `€${Math.round(v / 1000)}K` : `€${Math.round(v)}`}
          ariaLabel="Fatturato giornaliero del mese"
          totalOverride={canonicalFatturato !== null ? canonicalFatturato : undefined}
        />
        <TimeSeriesChart
          title={`Nuove Prenotazioni ${selMonthLabel}`}
          values={timeSeries.dailyNewBookings}
          daysInMonth={timeSeries.daysInMonth}
          monthIndex={selMonth.month - 1}
          year={selMonth.year}
          accent="cyan"
          format={(v) => `${Math.round(v)} prenotazioni`}
          formatAxis={(v) => `${Math.round(v)}`}
          ariaLabel="Nuove prenotazioni create per giorno"
        />
        <TimeSeriesChart
          title={`Auto Fuori ${selMonthLabel}`}
          values={timeSeries.dailyVehicles}
          daysInMonth={timeSeries.daysInMonth}
          monthIndex={selMonth.month - 1}
          year={selMonth.year}
          accent="amber"
          format={(v) => `${Math.round(v)} auto`}
          formatAxis={(v) => `${Math.round(v)}`}
          ariaLabel="Auto distinte fuori per giorno"
          totalOverride={timeSeries.monthlyUniqueVehicles}
          totalLabel={`${timeSeries.monthlyUniqueVehicles} auto distinte`}
        />
      </div>
    </div>
  )
}

/**
 * Pure-SVG line+area chart. Niente librerie esterne. Hover su un punto
 * mostra il tooltip con valore + data. Asse Y auto-scalato sul max della
 * serie (con padding del 15% per non tagliare il picco). Asse X mostra
 * 5 giorni equidistanti.
 */
function TimeSeriesChart({
  title,
  values,
  daysInMonth,
  monthIndex,
  year,
  accent,
  format,
  formatAxis,
  ariaLabel,
  totalOverride,
  totalLabel: totalLabelOverride,
}: {
  title: string
  values: number[]
  daysInMonth: number
  monthIndex: number
  year: number
  accent: 'emerald' | 'cyan' | 'amber'
  format: (v: number) => string
  formatAxis: (v: number) => string
  ariaLabel: string
  totalOverride?: number
  totalLabel?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const accentMap = {
    emerald: { stroke: '#10b981', fill: 'url(#g-emerald)', text: 'text-emerald-400', glow: 'shadow-emerald-500/10' },
    cyan:    { stroke: '#06b6d4', fill: 'url(#g-cyan)',    text: 'text-cyan-400',    glow: 'shadow-cyan-500/10' },
    amber:   { stroke: '#f59e0b', fill: 'url(#g-amber)',   text: 'text-amber-400',   glow: 'shadow-amber-500/10' },
  } as const
  const c = accentMap[accent]

  const W = 320
  const H = 140
  const padL = 40
  const padR = 12
  const padT = 14
  const padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const max = Math.max(1, ...values) * 1.15
  const x = (i: number) => padL + (daysInMonth <= 1 ? 0 : (i / (daysInMonth - 1)) * innerW)
  const y = (v: number) => padT + (innerH - (v / max) * innerH)

  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const areaPath = `M ${x(0)},${padT + innerH} L ${values.map((v, i) => `${x(i)},${y(v)}`).join(' L ')} L ${x(values.length - 1)},${padT + innerH} Z`

  // X-axis labels: 5 punti equidistanti
  const xTicks = [0, Math.floor(daysInMonth * 0.25) - 1, Math.floor(daysInMonth * 0.5) - 1, Math.floor(daysInMonth * 0.75) - 1, daysInMonth - 1]
    .filter((v, i, arr) => v >= 0 && arr.indexOf(v) === i)
  const monthShort = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'][monthIndex]

  // 2026-05-22: totalOverride permette di sostituire il default
  // (sommare values) con un valore semanticamente piu' corretto, es. auto
  // uniche del mese invece di somma auto-giorni.
  const total = typeof totalOverride === 'number' ? totalOverride : values.reduce((a, b) => a + b, 0)
  const totalLabel = totalLabelOverride ?? format(total)

  return (
    <div className="relative rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-theme-text-muted truncate">{title}</div>
        <div className={`text-xs font-semibold ${c.text}`}>{totalLabel}</div>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          width="100%"
          height={H}
          role="img"
          aria-label={ariaLabel}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="g-emerald" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="g-cyan" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="g-amber" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* y-axis grid (4 lines) */}
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
            const yPos = padT + innerH * (1 - p)
            const label = formatAxis(max * p)
            return (
              <g key={i}>
                <line x1={padL} x2={padL + innerW} y1={yPos} y2={yPos} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
                <text x={padL - 6} y={yPos + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity="0.4">{label}</text>
              </g>
            )
          })}

          {/* area + line */}
          {values.length > 1 && (
            <>
              <path d={areaPath} fill={c.fill} />
              <polyline points={points} fill="none" stroke={c.stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}

          {/* hover hit-areas (invisible) */}
          {values.map((_, i) => (
            <rect
              key={i}
              x={x(i) - (innerW / daysInMonth) / 2}
              y={padT}
              width={innerW / Math.max(1, daysInMonth)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}

          {/* hover indicator */}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke={c.stroke} strokeOpacity="0.4" strokeDasharray="2 3" />
              <circle cx={x(hover)} cy={y(values[hover])} r="3.5" fill={c.stroke} stroke="var(--color-theme-bg-secondary, #111)" strokeWidth="2" />
            </g>
          )}

          {/* x-axis labels */}
          {xTicks.map(t => (
            <text key={t} x={x(t)} y={H - 8} fontSize="9" textAnchor="middle" fill="currentColor" opacity="0.4">
              {t + 1} {monthShort}
            </text>
          ))}
        </svg>

        {/* hover tooltip (HTML overlay) */}
        {hover !== null && (
          <div
            className="absolute pointer-events-none px-2.5 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-[10px] shadow-lg whitespace-nowrap"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              top: `${(y(values[hover]) / H) * 100}%`,
              transform: 'translate(-50%, calc(-100% - 8px))',
            }}
          >
            <div className="text-theme-text-muted">{hover + 1} {monthShort} {year}</div>
            <div className={`font-bold ${c.text}`}>{format(values[hover])}</div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Card Fatturato. 2026-05-22: rimosso il dropdown squadrato; restano
 * solo frecce ‹ › pulite per cambiare mese (la fattura del mese
 * selezionato viene mostrata anche cambiando in mesi diversi).
 */
function FatturatoMonthCard({
  value,
  monthLabel,
  year,
  month,
  onChange,
}: {
  value: string
  monthLabel: string
  year: number
  month: number
  onChange: (year: number, month: number) => void
}) {
  const currentYear = new Date().getFullYear()
  const yearSuffix = year !== currentYear ? ` ${year}` : ''
  return (
    <div className="relative rounded-2xl border border-theme-border bg-theme-bg-secondary px-4 py-3.5 overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-theme-text-muted truncate">
          Fatturato {monthLabel}{yearSuffix}
        </span>
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 font-bold text-sm">€</span>
      </div>
      <div className="mt-2 text-2xl sm:text-[28px] font-bold text-theme-text-primary leading-tight tabular-nums">{value}</div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-theme-text-muted">
        <button
          type="button"
          onClick={() => {
            const m = month === 1 ? 12 : month - 1
            const y = month === 1 ? year - 1 : year
            onChange(y, m)
          }}
          className="hover:text-dr7-gold transition-colors px-1"
          aria-label="Mese precedente"
          title="Mese precedente"
        >‹</button>
        <span className="font-medium text-theme-text-secondary">{monthLabel} {year}</span>
        <button
          type="button"
          onClick={() => {
            const m = month === 12 ? 1 : month + 1
            const y = month === 12 ? year + 1 : year
            onChange(y, m)
          }}
          className="hover:text-dr7-gold transition-colors px-1"
          aria-label="Mese successivo"
          title="Mese successivo"
        >›</button>
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon,
  accent,
  hint,
}: {
  label: string
  value: string
  icon: React.ReactNode
  accent: 'cyan' | 'blue' | 'green' | 'amber'
  hint?: string
}) {
  // Mappa accent -> classi Tailwind. Le pillole icona usano bg/text del
  // colore; il bordo della card resta neutro per non rumore visivo.
  const accentMap: Record<string, { bg: string; text: string; hintText: string }> = {
    cyan:  { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    hintText: 'text-theme-text-muted' },
    blue:  { bg: 'bg-blue-500/10',    text: 'text-blue-400',    hintText: 'text-theme-text-muted' },
    green: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', hintText: 'text-theme-text-muted' },
    amber: { bg: 'bg-amber-500/10',   text: 'text-amber-400',   hintText: 'text-amber-400' },
  }
  const c = accentMap[accent]
  return (
    <div className="relative rounded-2xl border border-theme-border bg-theme-bg-secondary px-4 py-3.5 overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-theme-text-muted">{label}</span>
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${c.bg} ${c.text}`}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl sm:text-[28px] font-bold text-theme-text-primary leading-tight tabular-nums">{value}</div>
      {hint && <div className={`mt-1 text-[11px] ${c.hintText} font-medium`}>{hint}</div>}
    </div>
  )
}
