import { useState, useEffect, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import { appendPreventivoEvent } from '../../../utils/preventivoEvents'
import { useRentalConfig } from '../../../hooks/useRentalConfig'
import { buildConfigOverlay } from '../../../utils/configOverlay'
import { getKmIncluded, getInsuranceOptions, getUnlimitedKmPrice } from '../../../utils/configLookup'
import type { RentalConfig } from '../../../types/rentalConfig'
import Input from './Input'
import Select from './Select'
import PreventivoRejectModal, { openPreventivoRejectModal } from './PreventivoRejectModal'
import PreventivoAcceptModal, { openPreventivoAcceptModal } from './PreventivoAcceptModal'
import Button from './Button'
import CustomerAutocomplete from './CustomerAutocomplete'
import LimitationOverrideModal from '../../../components/LimitationOverrideModal'
import { isOtpRequired } from '../../../utils/otpConfigCache'
import ClientStatusBadge from '../../../components/ClientStatusBadge'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { classifyDriverTier, calculateAge, calculateLicenseYears } from '../../../utils/tierClassification'
import { isVehicleAvailable, type Vehicle as AvailabilityVehicle, type Booking as AvailabilityBooking } from '../../../utils/vehicleAvailability'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildBookingContext } from '../../../utils/adminLogHelpers'
import { getHolidayForDate, isSunday as isSundayDate } from '../../../data/italianHolidays'
import {
  getOfficeMinuteRangesForDate,
  isWithinOfficeHoursForDate,
} from '../../../utils/noleggioHours'

// ─── Time slots ─────────────────────────────────────────────────────────────
//
// Preventivi historically only offered office-hour slots (pickup 10:30-12:30 +
// 15:30-18:30, return 09:00-12:30 + 14:00-17:30). The picker now exposes the
// FULL day in 15-minute steps so the admin can choose any time, but slots
// that fall outside office hours, on a Sunday, on an Italian holiday, or
// that conflict with another booking on the same vehicle are flagged red.
// Selecting a flagged slot triggers the existing OTP override modal.
//
// Office windows are kept here (single source of truth) so future tweaks
// don't have to chase multiple files.
//
//   Mon–Fri: 09:00–13:00 + 15:00–19:00 (pickup AND return)
//   Saturday: TODO_SATURDAY — currently mirrors Mon–Fri until the
//             customer-supplied window arrives
//   Sunday: closed (handled by classifyDay)

// Rental schedule comes from Centralina Pro > Orari Noleggio
// (utils/noleggioHours). Defaults match the legacy hardcoded values:
//   PICKUP  Mon-Fri: 10:30-12:30 / 16:30-18:30, Sat 10:30-16:30
//   RETURN  Mon-Fri: 09:00-11:00 / 15:00-17:00, Sat 09:00-15:00
function getOfficeHoursForDate(dateStr: string, kind: 'pickup' | 'return' = 'pickup'): [number, number][] | null {
  const ranges = getOfficeMinuteRangesForDate(dateStr, kind)
  return ranges.length === 0 ? null : ranges
}

function genAllDaySlots(): { value: string; label: string }[] {
  const s: { value: string; label: string }[] = []
  for (let m = 0; m < 24*60; m += 15) {
    const t = `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`
    s.push({ value: t, label: t })
  }
  return s
}
const ALL_DAY_SLOTS = genAllDaySlots()

// Style applied to flagged (exceptional) <option> entries. Native <option>
// styling is limited but color/backgroundColor are honored on Chrome/Edge/
// Firefox desktop. Safari/iOS fall back to plain text — UX still works
// because the OTP modal triggers on selection regardless.
const FLAGGED_OPTION_STYLE: React.CSSProperties = { color: 'white', backgroundColor: '#dc2626', fontWeight: 600 }
const NORMAL_OPTION_STYLE: React.CSSProperties = { color: 'black', backgroundColor: 'white' }

interface DayClassification {
  type: 'open' | 'sunday' | 'holiday'
  label?: string
}
function classifyDay(dateStr: string): DayClassification {
  if (!dateStr) return { type: 'open' }
  // Parse YYYY-MM-DD as a local date (avoid UTC offset off-by-one)
  const [y, mo, d] = dateStr.split('-').map(Number)
  if (!y || !mo || !d) return { type: 'open' }
  const date = new Date(y, mo - 1, d)
  if (isSundayDate(date)) return { type: 'sunday', label: 'Domenica (chiusura)' }
  const holiday = getHolidayForDate(date)
  if (holiday) return { type: 'holiday', label: `Festività: ${holiday.name}` }
  return { type: 'open' }
}

function buildTimeOptions(
  dateStr: string,
  kind: 'pickup' | 'return',
): { value: string; label: string; style: React.CSSProperties; flagged: boolean }[] {
  const day = classifyDay(dateStr)
  const isClosedDay = day.type !== 'open'
  return ALL_DAY_SLOTS.map(s => {
    const inHours = isWithinOfficeHoursForDate(dateStr, s.value, kind)
    const flagged = isClosedDay || !inHours
    return {
      value: s.value,
      // Loud label so admins notice even when browsers strip <option>
      // CSS (Safari/iOS).
      label: flagged ? `🔴 ${s.label}  FUORI ORARIO` : s.label,
      style: flagged ? FLAGGED_OPTION_STYLE : NORMAL_OPTION_STYLE,
      flagged,
    }
  })
}

function formatRanges(ranges: [number, number][]): string {
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return ranges.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(' / ')
}

function describeException(dateStr: string, time: string, kind: 'pickup' | 'return'): string | null {
  const day = classifyDay(dateStr)
  if (day.type === 'sunday') return 'Domenica — sede chiusa'
  if (day.type === 'holiday') return day.label || 'Giorno festivo'
  if (!isWithinOfficeHoursForDate(dateStr, time, kind)) {
    const ranges = getOfficeHoursForDate(dateStr, kind) || []
    const hoursLabel = formatRanges(ranges)
    return kind === 'pickup'
      ? `Orario di ritiro fuori dagli orari ufficio (${hoursLabel})`
      : `Orario di riconsegna fuori dagli orari ufficio (${hoursLabel})`
  }
  return null
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface Vehicle {
  id: string
  display_name: string
  plate: string | null
  status: string
  daily_rate: number
  category: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | null
}

interface Preventivo {
  id: string
  vehicle_id: string
  vehicle_name: string
  vehicle_plate: string | null
  vehicle_category: string | null
  vehicle_model_year: number | null
  vehicle_cv: number | null
  vehicle_0_100: number | null
  pickup_date: string
  dropoff_date: string
  rental_days: number
  base_daily_rate: number
  maggiorazione_pct: number
  daily_rate_after_markup: number | null
  insurance_option: string | null
  insurance_daily_price: number
  insurance_total: number
  lavaggio_fee: number
  no_cauzione_daily: number
  no_cauzione_total: number
  unlimited_km_daily: number
  unlimited_km_total: number
  second_driver_daily: number
  second_driver_total: number
  subtotal: number
  sconto: number
  sconto_note: string | null
  total_final: number
  pricing_trace: Record<string, unknown> | null
  extras_detail: Record<string, unknown> | null
  customer_phone: string | null
  customer_name: string | null
  driver_tier: string | null
  status: string
  motivo_rifiuto?: string | null
  motivo_rifiuto_note?: string | null
  booking_id: string | null
  whatsapp_sent_at: string | null
  whatsapp_message_id: string | null
  sent_by: string | null
  source: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  expires_at: string | null
  customer_id: string | null
}

interface InsuranceOpt {
  id: string
  label: string
  pricePerDay: number
}

type DriverTier = 'TIER_1' | 'TIER_2'

interface Props {
  onConvertToBooking?: (data: {
    vehicleId: string
    pickupDate: Date
    fromPreventivo: Record<string, unknown>
  }) => void
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatEur(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

function getInsuranceOptionsForVehicle(
  vehicle: Vehicle | undefined,
  tier: DriverTier,
  overlay: ReturnType<typeof buildConfigOverlay>,
  rentalConfig: RentalConfig | null
): InsuranceOpt[] {
  if (!vehicle) return tier === 'TIER_2' ? overlay.insuranceTier2 : overlay.insuranceTier1

  // Use vehicle category to look up from config
  const category = vehicle.category || 'exotic'
  if (rentalConfig) {
    const opts = getInsuranceOptions(rentalConfig, category, tier)
    if (opts.length > 0) {
      return opts.map(o => ({ id: o.id, label: o.name, pricePerDay: o.daily_price }))
    }
  }

  // Fallback to overlay
  if (category === 'urban') return overlay.urbanInsurance
  if (category === 'aziendali') return overlay.utilitaireInsurance
  return tier === 'TIER_2' ? overlay.insuranceTier2 : overlay.insuranceTier1
}

function getUnlimitedKmPriceForVehicle(vehicle: Vehicle | undefined, tier: DriverTier, rentalConfig: RentalConfig | null, overlay: ReturnType<typeof buildConfigOverlay>): number {
  if (!vehicle) return tier === 'TIER_2' ? overlay.unlimitedKmTier2 : overlay.unlimitedKmTier1

  const category = vehicle.category || 'exotic'
  if (rentalConfig) {
    return getUnlimitedKmPrice(rentalConfig, category, tier)
  }

  return tier === 'TIER_2' ? overlay.unlimitedKmTier2 : overlay.unlimitedKmTier1
}

// Resolve KM inclusi for a (vehicle category, days) pair.
// Prefers Centralina Pro (source of truth post-April 2026), falls back to
// legacy rental_config. Guarantees a finite number or 'unlimited' — never NaN.
function resolveKmIncluded(
  vehCategory: string | null | undefined,
  rentalDays: number,
  proKm: Array<Record<string, unknown>> | null,
  rentalConfig: RentalConfig | null,
): number | 'unlimited' {
  if (!Number.isFinite(rentalDays) || rentalDays < 1) return 0

  // Map DB vehicle category → Centralina Pro key (mirrors proCategoryKey)
  const cat = String(vehCategory || '').toLowerCase().trim()
  let proKey = 'urban'
  if (cat === 'supercar' || cat === 'supercars' || cat === 'exotic') proKey = 'supercars'
  else if (cat === 'furgone' || cat === 'furgoni' || cat === 'aziendali' || cat === 'ncc') proKey = 'aziendali'

  const proEntry = (proKm || []).find(k => (k as { id?: string })?.id === proKey) as
    | { table?: Record<string, number | string>; extraPerDay?: number | string }
    | undefined

  if (proEntry) {
    const rawTable = proEntry.table || {}
    const table: Record<number, number> = {}
    for (const [k, v] of Object.entries(rawTable)) {
      const nk = Number(k)
      const nv = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(nk) && Number.isFinite(nv)) table[nk] = nv
    }
    const extraPerDay = (() => {
      const v = typeof proEntry.extraPerDay === 'number' ? proEntry.extraPerDay : Number(proEntry.extraPerDay)
      return Number.isFinite(v) ? v : 0
    })()
    const tableDays = Object.keys(table).map(Number).filter(n => Number.isFinite(n))
    const hasLimits = tableDays.length > 0 && Object.values(table).some(v => v > 0)

    if (!hasLimits && extraPerDay === 0) {
      return 'unlimited'
    }
    if (hasLimits) {
      const maxDay = Math.max(...tableDays)
      const result = rentalDays <= maxDay
        ? (table[rentalDays] ?? table[maxDay] ?? 0)
        : ((table[maxDay] ?? 0) + (rentalDays - maxDay) * extraPerDay)
      return Number.isFinite(result) ? result : 0
    }
  }

  // Legacy fallback (Centralina Unica) — also guard against NaN leaks
  if (rentalConfig) {
    const r = getKmIncluded(rentalConfig, rentalDays, vehCategory || 'exotic')
    if (r === 'unlimited') return 'unlimited'
    return Number.isFinite(r as number) ? (r as number) : 0
  }
  return 0
}

// km-quote map: { [serviceId]: { km: number; pricePerKm: number } } — used
// only for services whose unit is 'per_km' (operator types both values at
// quote time). Cost = km × pricePerKm.
type KmQuoteMap = Record<string, { km: number; pricePerKm: number }>

function calculateExperienceCost(
  services: Record<string, number>,
  rentalDays: number,
  allServices: { id: string; name: string; price: number; unit: string }[],
  kmQuotes: KmQuoteMap = {},
): number {
  let total = 0
  // Standard services (per_day / per_hour / per_item / flat) — keyed by qty.
  for (const [id, qty] of Object.entries(services)) {
    if (qty <= 0) continue
    const svc = allServices.find(s => s.id === id)
    if (!svc) continue
    if (svc.unit === 'per_day') total += svc.price * rentalDays * qty
    else if (svc.unit === 'per_hour') total += svc.price * qty
    else if (svc.unit === 'per_item') total += svc.price * qty
    else if (svc.unit === 'flat') total += svc.price * qty
  }
  // Per-km services — keyed in a separate map by { km, pricePerKm }.
  for (const [id, q] of Object.entries(kmQuotes)) {
    if (!q || q.km <= 0 || q.pricePerKm <= 0) continue
    const svc = allServices.find(s => s.id === id)
    if (!svc || svc.unit !== 'per_km') continue
    total += q.km * q.pricePerKm
  }
  return Math.round(total * 100) / 100
}

const UNIT_LABELS: Record<string, string> = {
  per_day: '/giorno',
  per_hour: '/ora',
  per_item: '/unita',
  flat: 'fisso',
  per_km: '/km',
}

function renderWhatsAppHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // WhatsApp-style formatting: *bold*, _italic_, ~strike~, `mono`
  return escaped
    .replace(/\*([^*\n]+?)\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_([^_\n]+?)_(?=\s|$|[.,!?:;)])/g, '$1<em>$2</em>')
    .replace(/~([^~\n]+?)~/g, '<s>$1</s>')
    .replace(/`([^`\n]+?)`/g, '<code>$1</code>')
}

// LOCATIONS is now built dynamically inside the component from
// configOverlay.pickupLocations. The two built-ins (DR7 office, domicilio)
// stay hardcoded because their fee semantics differ — office is always
// free, domicilio is admin-typed per booking.
type LocationOption = { value: string; label: string; fee: number }

const STATUS_LABELS: Record<string, string> = {
  bozza: 'Bozza',
  inviato: 'Inviato',
  accettato: 'Accettato',
  rifiutato: 'Rifiutato',
  scaduto: 'Scaduto',
}

const STATUS_COLORS: Record<string, string> = {
  bozza: 'bg-gray-600 text-gray-100',
  inviato: 'bg-blue-600 text-blue-100',
  accettato: 'bg-green-600 text-green-100',
  rifiutato: 'bg-red-600 text-red-100',
  scaduto: 'bg-yellow-700 text-yellow-100',
}

// ─── Component ──────────────────────────────────────────────────────────────

// WhatsApp di reportistica boss — usato per gli alert "preventivo creato".
// Sorgente: centralina_pro_config.config.notifications.boss_whatsapp_phone
// (modificabile da Gestione OTP). Fallback hardcoded per recovery.
const BOSS_PHONE_FALLBACK = '393472817258'
async function getBossPhone(): Promise<string> {
  try {
    const { data } = await supabase
      .from('centralina_pro_config')
      .select('config')
      .eq('id', 'main')
      .maybeSingle()
    const cfg = (data?.config || {}) as Record<string, unknown>
    const notif = (cfg.notifications || {}) as Record<string, unknown>
    const v = notif.boss_whatsapp_phone
    if (typeof v === 'string' && v.trim().length > 0) return v.trim().replace(/[\s+-]/g, '')
  } catch { /* fallback */ }
  return BOSS_PHONE_FALLBACK
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function PreventiviTab({ onConvertToBooking: _onConvertToBooking }: Props) {
  const { adminEmail, hasRole } = useAdminRole()
  // Storica: solo Valerio. Ora gestita tramite `role:preventivi-admin`
  // (failsafe valerio/ilenia). Conserva la stessa semantica della whitelist.
  const isValerio = hasRole('preventivi-admin')
  const [view, setView] = useState<'list' | 'form'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [preventivi, setPreventivi] = useState<Preventivo[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false)
  const [selectedPreventivo, setSelectedPreventivo] = useState<Preventivo | null>(null)
  const [previewMessage, setPreviewMessage] = useState<string>('')
  // Default OFF — admin opts in per-message. The block only renders if the
  // template contains {coefficienti} or {coefficiente_combinato} AND the
  // checkbox is checked.
  const [includeCoefficienti, setIncludeCoefficienti] = useState<boolean>(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  // Modal "Rifiutato" — stato isolato dentro PreventivoRejectModal e aperto
  // tramite CustomEvent su window, così aprirlo NON ri-renderizza l'intera
  // lista preventivi (era il motivo dei 15 sec di apertura).
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [customers, setCustomers] = useState<any[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [tierReason, setTierReason] = useState<string>('')
  // No Cauzione requests (from bookings table)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [noCauzioneRequests, setNoCauzioneRequests] = useState<any[]>([])
  const [noCauzioneLoading, setNoCauzioneLoading] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [sortField, setSortField] = useState<'created_at' | 'pickup_date' | 'total_final' | 'rental_days'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // No-Cauzione OTP override (when client is Fascia B and admin is not Valerio)
  const draftSessionIdRef = useRef<string>(crypto.randomUUID())
  const [noCauzioneOverrideId, setNoCauzioneOverrideId] = useState<string | null>(null)

  // Slot-unavailable OTP override (same-car buffer OR 15-min cross-vehicle gap)
  const [slotOverrideId, setSlotOverrideId] = useState<string | null>(null)
  // Holds the `send` flag from the operator's Salva click while an OTP modal
  // is open. Cleared on cancel (X) or once the resume effect re-runs
  // handleSave with fresh override IDs.
  const pendingSaveRef = useRef<{ send: boolean } | null>(null)
  const [slotUnavailableWarning, setSlotUnavailableWarning] = useState<string>('')

  // Out-of-office-hours OTP override (admin picked a slot outside the
  // rental schedule). One approval per draft session — flipping back
  // and forth between flagged/in-window slots doesn't re-prompt.
  const [outOfHoursOverrideId, setOutOfHoursOverrideId] = useState<string | null>(null)
  const slotCheckTimerRef = useRef<number | null>(null)

  // Combined OTP modal: when più gate scattano insieme (es. No Cauzione +
  // Fuori orario), apriamo UNA sola modal con TUTTE le motivazioni. La
  // direzione riceve UNA sola email che elenca tutti i motivi reali della
  // richiesta. All'approvazione marchiamo come autorizzati tutti i gate
  // tripped (con lo stesso overrideId) così il resume non ri-prompta.
  type TrippedCode = 'out_of_hours' | 'no_cauzione' | 'slot'
  const [combinedOtpOpen, setCombinedOtpOpen] = useState(false)
  const [combinedOtpMotivazioni, setCombinedOtpMotivazioni] = useState<string[]>([])
  const [combinedOtpTripped, setCombinedOtpTripped] = useState<TrippedCode[]>([])

  // Centralina config
  const { config: rentalConfig } = useRentalConfig()
  const configOverlay = useMemo(() => buildConfigOverlay(rentalConfig), [rentalConfig])

  const LOCATIONS: LocationOption[] = useMemo(() => [
    { value: 'dr7_office', label: 'DR7 — Viale Marconi 229, Cagliari', fee: 0 },
    ...configOverlay.pickupLocations.map(p => ({ value: p.id, label: p.label, fee: p.fee })),
    { value: 'domicilio', label: 'Domicilio (indirizzo custom)', fee: 0 },
  ], [configOverlay.pickupLocations])

  // ─── Form State ─────────────────────────────────────────────────────────

  const [form, setForm] = useState({
    vehicle_id: '',
    pickup_date: '',
    pickup_time: '10:30',
    return_date: '',
    return_time: '09:00', // default: pickup 10:30 − 1h30 = 09:00
    driver_tier: 'TIER_2' as DriverTier,
    residente_sardegna: true,
    maggiorazione_pct: String(configOverlay.maggiorazionePct),
    insurance_option: '',
    // Extras
    include_lavaggio: true,
    include_no_cauzione: false,
    include_unlimited_km: false,
    include_second_driver: false,
    include_dr7_flex: false,
    include_cauzione_veicoli: false,
    // Delivery / Pickup
    pickup_location: 'dr7_office',
    dropoff_location: 'dr7_office',
    delivery_fee: '0',
    pickup_fee: '0',
    delivery_address: '',
    pickup_address: '',
    // Experience services: id → quantity
    experience_services: {} as Record<string, number>,
    // Per-km services: id → { km, pricePerKm } typed by the operator at quote time
    experience_km_quotes: {} as KmQuoteMap,
    // Discount
    sconto: '',
    sconto_note: 'valido solo 24h',
    // Vehicle specs (auto-filled from vehicle, editable)
    model_year: '',
    cv: '',
    acceleration_0_100: '',
  })

  // Computed values
  const selectedVehicle = useMemo(
    () => vehicles.find(v => v.id === form.vehicle_id),
    [vehicles, form.vehicle_id]
  )

  const rentalDays = useMemo(() => {
    if (!form.pickup_date || !form.return_date) return 0
    const pickup = new Date(`${form.pickup_date}T${form.pickup_time}`)
    const dropoff = new Date(`${form.return_date}T${form.return_time}`)
    return Math.max(1, Math.ceil((dropoff.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24)))
  }, [form.pickup_date, form.return_date, form.pickup_time, form.return_time])

  const insuranceOptions = useMemo(
    () => getInsuranceOptionsForVehicle(selectedVehicle, form.driver_tier, configOverlay, rentalConfig),
    [selectedVehicle, form.driver_tier, configOverlay]
  )

  const availableExperienceServices = useMemo(
    () => configOverlay.experienceServices.filter(s => !s.tierOnly || s.tierOnly === form.driver_tier),
    [configOverlay.experienceServices, form.driver_tier]
  )

  // Auto-check availability whenever vehicle/date/time changes.
  // The OTP modal is NOT opened here anymore — only a red warning is shown.
  // Authorization is requested only when the operator presses Salva.
  useEffect(() => {
    if (slotCheckTimerRef.current) {
      window.clearTimeout(slotCheckTimerRef.current)
    }
    // Skip if form is incomplete
    if (!form.vehicle_id || !form.pickup_date || !form.return_date || !form.pickup_time || !form.return_time) {
      setSlotUnavailableWarning('')
      return
    }
    // Skip if override already granted for this session
    if (slotOverrideId) {
      setSlotUnavailableWarning('')
      return
    }
    slotCheckTimerRef.current = window.setTimeout(async () => {
      // Day/hour exception checks run BEFORE the vehicle availability lookup —
      // they don't need the booking window data. Out-of-hours / Sunday /
      // holiday on either pickup or return is shown as a warning here; the
      // OTP gate fires at Salva time.
      const pickupExc = describeException(form.pickup_date, form.pickup_time, 'pickup')
      const returnExc = describeException(form.return_date, form.return_time, 'return')
      if (pickupExc || returnExc) {
        const reason = [
          pickupExc ? `Ritiro: ${pickupExc}` : null,
          returnExc ? `Riconsegna: ${returnExc}` : null,
        ].filter(Boolean).join(' · ')
        setSlotUnavailableWarning(reason)
        return
      }

      if (!selectedVehicle) return
      const windowStart = new Date(`${form.pickup_date}T00:00:00+02:00`)
      const windowEnd = new Date(`${form.return_date}T23:59:59+02:00`)
      windowStart.setDate(windowStart.getDate() - 1)
      windowEnd.setDate(windowEnd.getDate() + 1)
      const { data: windowBookings } = await supabase
        .from('bookings')
        .select('id,vehicle_id,vehicle_plate,vehicle_name,customer_name,pickup_date,dropoff_date,status,service_type,payment_method,payment_status')
        .lt('pickup_date', windowEnd.toISOString())
        .gt('dropoff_date', windowStart.toISOString())
      const availVehicle: AvailabilityVehicle = {
        id: selectedVehicle.id,
        display_name: selectedVehicle.display_name,
        plate: selectedVehicle.plate,
        status: (selectedVehicle.status === 'available' || selectedVehicle.status === 'rented' || selectedVehicle.status === 'maintenance' || selectedVehicle.status === 'retired')
          ? selectedVehicle.status
          : 'available',
        daily_rate: selectedVehicle.daily_rate,
        category: (selectedVehicle.category as AvailabilityVehicle['category']) || undefined,
        metadata: selectedVehicle.metadata,
        created_at: '',
        updated_at: '',
      }
      const result = isVehicleAvailable(
        availVehicle,
        form.pickup_date,
        form.return_date,
        form.pickup_time,
        form.return_time,
        (windowBookings || []) as AvailabilityBooking[],
      )
      if (!result.available) {
        const reason = result.reason || 'Slot non disponibile'
        setSlotUnavailableWarning(reason)
      } else {
        setSlotUnavailableWarning('')
      }
    }, 400)
    return () => {
      if (slotCheckTimerRef.current) window.clearTimeout(slotCheckTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vehicle_id, form.pickup_date, form.return_date, form.pickup_time, form.return_time, slotOverrideId])

  // ── Direct read of Centralina Pro (deposits + servizi + km) ──
  // Centralina Pro is the source of truth for all extras: noCauzione
  // surcharge, Lavaggio fee, Secondo Guidatore, DR7 FLEX, Km Illimitati.
  // The legacy `rental_config` (Centralina Unica) is kept only as a
  // fallback for installations that haven't migrated yet. Subscribe to
  // realtime updates so a price change in CentralinaProTab propagates
  // into open Preventivi forms without a reload.
  const [proDeposits, setProDeposits] = useState<Record<string, unknown> | null>(null)
  const [proServizi, setProServizi] = useState<{
    lavaggio?: { fee?: number | string; mandatory?: boolean }
    second_driver?: Record<string, number | string>
    dr7_flex?: { daily_price?: number | string; refund_percent?: number | string; tier_restriction?: string }
  } | null>(null)
  const [proKm, setProKm] = useState<Array<{
    id?: string
    label?: string
    extraPerDay?: number | string
    sforo?: number | string
    unlimitedPerDay?: number | string
    unlimitedMode?: 'all_tiers' | 'per_fascia'
    unlimitedByFascia?: Record<string, number | string>
  }> | null>(null)
  // Toggle Automazioni: per ogni extra, incluso nel coefficiente dinamico?
  // Default: KM Illimitati escluso (a listino), tutti gli altri inclusi.
  // Direzione li flippa da Centralina Pro > Automazioni > Inclusione coefficiente.
  type CoeffFlags = {
    unlimited_km: boolean
    insurance: boolean
    lavaggio: boolean
    no_cauzione: boolean
    second_driver: boolean
    dr7_flex: boolean
    cauzione_veicoli: boolean
  }
  const [coeffFlags, setCoeffFlags] = useState<CoeffFlags>({
    unlimited_km: false,
    insurance: true,
    lavaggio: true,
    no_cauzione: true,
    second_driver: true,
    dr7_flex: true,
    cauzione_veicoli: true,
  })
  useEffect(() => {
    let cancelled = false
    const applyConfig = (cfg: Record<string, unknown> | undefined) => {
      const c = (cfg || {}) as {
        deposits?: Record<string, unknown>
        servizi?: typeof proServizi
        km?: typeof proKm
        automations?: {
          coefficient_unlimited_km?: boolean
          coefficient_insurance?: boolean
          coefficient_lavaggio?: boolean
          coefficient_no_cauzione?: boolean
          coefficient_second_driver?: boolean
          coefficient_dr7_flex?: boolean
          coefficient_cauzione_veicoli?: boolean
        }
      }
      setProDeposits(c.deposits || null)
      setProServizi(c.servizi || null)
      setProKm(c.km || null)
      const a = c.automations || {}
      setCoeffFlags({
        unlimited_km:     !!a.coefficient_unlimited_km,
        insurance:        a.coefficient_insurance !== false,
        lavaggio:         a.coefficient_lavaggio !== false,
        no_cauzione:      a.coefficient_no_cauzione !== false,
        second_driver:    a.coefficient_second_driver !== false,
        dr7_flex:         a.coefficient_dr7_flex !== false,
        cauzione_veicoli: a.coefficient_cauzione_veicoli !== false,
      })
    }
    ;(async () => {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      if (cancelled) return
      applyConfig(data?.config as Record<string, unknown> | undefined)
    })()
    const channel = supabase
      .channel('preventivi-pro-config')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' }, (payload) => {
        const cfg = (payload.new as { config?: Record<string, unknown> } | undefined)?.config
        if (cfg && typeof cfg === 'object') applyConfig(cfg)
      })
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Map vehicle DB category → Pro km/deposits category key. Reused by
  // both the deposits lookup and the km-unlimited lookup so they stay in
  // lockstep.
  const proCategoryKey = useMemo(() => {
    const vehCat = String(selectedVehicle?.category || '').toLowerCase().trim()
    if (vehCat === 'supercar' || vehCat === 'supercars' || vehCat === 'exotic') return 'supercars'
    if (vehCat === 'furgone' || vehCat === 'furgoni' || vehCat === 'aziendali' || vehCat === 'ncc') return 'aziendali'
    return 'urban'
  }, [selectedVehicle])

  // Pro-resolved extras with safe fallbacks. Each falls back to the
  // legacy Centralina Unica overlay (keeps the form working until the
  // operator finishes migrating). When the operator changes a price
  // in Centralina Pro the realtime subscription fires applyConfig and
  // these useMemos recompute automatically.
  const proLavaggioFee = useMemo(() => {
    const v = Number(proServizi?.lavaggio?.fee)
    return Number.isFinite(v) && v > 0 ? v : (configOverlay.lavaggioFee || 0)
  }, [proServizi, configOverlay.lavaggioFee])

  const proSecondDriverDaily = useMemo(() => {
    const fascia = form.driver_tier === 'TIER_1' ? 'B' : 'A'
    const v = Number(proServizi?.second_driver?.[fascia])
    if (Number.isFinite(v) && v > 0) return v
    return form.driver_tier === 'TIER_2' ? configOverlay.secondDriverTier2 : configOverlay.secondDriverTier1
  }, [proServizi, form.driver_tier, configOverlay.secondDriverTier1, configOverlay.secondDriverTier2])

  const proDr7FlexDaily = useMemo(() => {
    const v = Number(proServizi?.dr7_flex?.daily_price)
    return Number.isFinite(v) && v > 0 ? v : (configOverlay.dr7FlexPerDay || 0)
  }, [proServizi, configOverlay.dr7FlexPerDay])

  const proUnlimitedKmDaily = useMemo(() => {
    const fascia = form.driver_tier === 'TIER_1' ? 'B' : 'A'
    const entry = (proKm || []).find(k => k.id === proCategoryKey)
    if (entry) {
      if (entry.unlimitedMode === 'per_fascia') {
        const v = Number(entry.unlimitedByFascia?.[fascia])
        if (Number.isFinite(v) && v > 0) return v
      }
      const v = Number(entry.unlimitedPerDay)
      if (Number.isFinite(v) && v > 0) return v
    }
    return getUnlimitedKmPriceForVehicle(selectedVehicle, form.driver_tier, rentalConfig, configOverlay)
  }, [proKm, proCategoryKey, form.driver_tier, selectedVehicle, rentalConfig, configOverlay])

  const noCauzioneResolvedDaily = useMemo(() => {
    const fallback = configOverlay.noCauzionePerDay || 0
    if (!proDeposits) return fallback

    // Detect new (per-category) vs old (per-fascia at root) shape.
    const firstVal = Object.values(proDeposits)[0] as Record<string, unknown> | undefined
    const isOld = !!firstVal && typeof firstVal === 'object'
      && ('residente' in firstVal || 'non_residente' in firstVal)

    // Map vehicle DB category → Pro deposits category key.
    const vehCat = String(selectedVehicle?.category || '').toLowerCase().trim()
    const proCategory = vehCat === 'supercar' || vehCat === 'supercars' || vehCat === 'exotic'
      ? 'supercars'
      : vehCat === 'furgone' || vehCat === 'furgoni' || vehCat === 'aziendali' || vehCat === 'ncc'
      ? 'aziendali'
      : 'urban'

    // TIER_1 = Fascia B (younger / less experienced), TIER_2 = Fascia A.
    const fasciaKey = form.driver_tier === 'TIER_1' ? 'B' : 'A'
    const residencyKey = form.residente_sardegna ? 'residente' : 'non_residente'

    let opts: { id?: string; label?: string; surcharge_per_day?: number | string }[] = []
    if (isOld) {
      const fasciaCfg = (proDeposits[fasciaKey] as { residente?: unknown; non_residente?: unknown } | undefined)
      opts = (fasciaCfg?.[residencyKey] as typeof opts) || []
    } else {
      const catCfg = proDeposits[proCategory] as Record<string, { residente?: unknown; non_residente?: unknown }> | undefined
      const fasciaCfg = catCfg?.[fasciaKey]
      opts = (fasciaCfg?.[residencyKey] as typeof opts) || []
    }

    // Match the "no cauzione" option in either of two ways:
    //   1. id === 'no_deposit' — the canonical key set by the seed configs
    //   2. label matches /nessuna cauzione|no cauzione/i — covers options
    //      the operator added via "Aggiungi opzione" in Centralina Pro
    //      (those get a random uid() as id, NOT 'no_deposit', so id-only
    //      matching silently falls through to 0 even when the surcharge
    //      is configured).
    const isNoDepositOpt = (o: { id?: string; label?: string }) => {
      if (o.id === 'no_deposit') return true
      const label = String(o.label || '').toLowerCase().trim()
      return /nessuna\s+cauzione|no\s+cauzione|^no_deposit$/i.test(label)
    }
    const fromPro = opts.find(isNoDepositOpt)?.surcharge_per_day
    const num = Number(fromPro)
    if (Number.isFinite(num) && num > 0) return num
    return fallback
  }, [proDeposits, selectedVehicle, form.driver_tier, form.residente_sardegna, configOverlay.noCauzionePerDay])

  // Revenue pricing
  const [revenueData, setRevenueData] = useState<{
    finalDailyRateEur: number
    finalTotalEur: number
    selectedBaseRateEur?: number
    rentalDays: number
    breakdown: { label: string; coeff: number; description: string }[]
    mode: string
    enabled: boolean
    minPrice?: number | null
    maxPrice?: number | null
    minHit?: boolean
    maxHit?: boolean
  } | null>(null)
  const [revenueLoading, setRevenueLoading] = useState(false)

  // Fetch revenue price when vehicle/dates change
  useEffect(() => {
    if (!form.vehicle_id || !form.pickup_date || !form.return_date) {
      setRevenueData(null)
      return
    }
    const pickup = `${form.pickup_date}T${form.pickup_time}`
    const dropoff = `${form.return_date}T${form.return_time}`

    let cancelled = false
    setRevenueLoading(true)
    fetch('/.netlify/functions/calculate-dynamic-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: form.vehicle_id, pickup_date: pickup, dropoff_date: dropoff })
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.enabled && data.finalTotalEur) {
          setRevenueData(data)
        } else {
          setRevenueData(null)
        }
      })
      .catch(() => { if (!cancelled) setRevenueData(null) })
      .finally(() => { if (!cancelled) setRevenueLoading(false) })

    return () => { cancelled = true }
  }, [form.vehicle_id, form.pickup_date, form.return_date, form.pickup_time, form.return_time])

  // Auto-fill vehicle specs when vehicle changes
  useEffect(() => {
    if (!selectedVehicle) return
    const meta = selectedVehicle.metadata || {}
    setForm(prev => ({
      ...prev,
      model_year: meta.model_year?.toString() || prev.model_year,
      cv: meta.cv?.toString() || prev.cv,
      acceleration_0_100: meta.acceleration_0_100?.toString() || prev.acceleration_0_100,
    }))
  }, [selectedVehicle])

  // ─── Pricing Calculation ────────────────────────────────────────────────

  const pricing = useMemo(() => {
    // Base rate: per-vehicle from Prezzo Dinamico > category tariffe
    let listDailyRate = 0

    // Priority 1: per-vehicle price from dynamic engine (Centralina Pro Prezzi Base per Veicolo)
    if (revenueData?.enabled && revenueData.selectedBaseRateEur) {
      listDailyRate = revenueData.selectedBaseRateEur
    }
    // Priority 2: category tariffe from Centralina Pro
    else if (rentalConfig && selectedVehicle && rentalDays >= 1) {
      const category = selectedVehicle.category || 'exotic'
      const dayRates = rentalConfig.rental_day_rates?.[category]
      if (dayRates) {
        const table = dayRates.flat || dayRates.resident || dayRates.non_resident
        if (table) {
          const directTotal = table[String(rentalDays)]
          if (directTotal) {
            listDailyRate = Math.round(directTotal / rentalDays * 100) / 100
          } else {
            const maxDay = Math.max(...Object.keys(table).map(Number).filter(n => !isNaN(n)))
            if (maxDay > 0 && table[String(maxDay)]) {
              const lastTotal = table[String(maxDay)]
              const avgPerDay = lastTotal / maxDay
              const extraDays = rentalDays - maxDay
              const total = lastTotal + extraDays * avgPerDay
              listDailyRate = Math.round(total / rentalDays * 100) / 100
            }
          }
        }
      }
    }
    const maggiorazione = parseFloat(form.maggiorazione_pct) || 0

    // Base prices at list rate
    const listRentalTotal = Math.round(listDailyRate * rentalDays * 100) / 100

    const selectedIns = insuranceOptions.find(i => i.id === form.insurance_option)
    const insuranceDailyPrice = selectedIns?.pricePerDay ?? 0
    const insuranceTotal = Math.round(insuranceDailyPrice * rentalDays * 100) / 100

    const lavaggioFee = form.include_lavaggio ? proLavaggioFee : 0

    const noCauzioneDaily = form.include_no_cauzione ? noCauzioneResolvedDaily : 0
    const noCauzioneTotal = Math.round(noCauzioneDaily * rentalDays * 100) / 100

    const unlimitedKmDaily = form.include_unlimited_km ? proUnlimitedKmDaily : 0
    const unlimitedKmTotal = Math.round(unlimitedKmDaily * rentalDays * 100) / 100

    const secondDriverDaily = form.include_second_driver ? proSecondDriverDaily : 0
    const secondDriverTotal = Math.round(secondDriverDaily * rentalDays * 100) / 100

    const dr7FlexDaily = form.include_dr7_flex ? proDr7FlexDaily : 0
    const dr7FlexTotal = Math.round(dr7FlexDaily * rentalDays * 100) / 100

    // Cauzione veicoli: €20/giorno (override possibile via configOverlay se impostato)
    const CAUZIONE_VEICOLI_DAILY_DEFAULT = 20
    const cauzioneVeicoliDaily = form.include_cauzione_veicoli
      ? ((configOverlay as any).cauzioneVeicoliPerDay ?? CAUZIONE_VEICOLI_DAILY_DEFAULT)
      : 0
    const cauzioneVeicoliTotal = Math.round(cauzioneVeicoliDaily * rentalDays * 100) / 100

    const deliveryFee = parseFloat(form.delivery_fee) || 0
    const pickupFee = parseFloat(form.pickup_fee) || 0

    const experienceCost = calculateExperienceCost(form.experience_services, rentalDays, configOverlay.experienceServices, form.experience_km_quotes)

    // Product of revenue coefficients.
    const revenueCoeff = revenueData?.enabled
      ? (revenueData.breakdown || []).reduce((acc, b) => acc * b.coeff, 1)
      : 1

    // List totals split by whether they're subject to the min/max clamp.
    // Experience services AND location fees (consegna + ritiro) are
    // INTENTIONALLY excluded from the coefficient and clamp — Experience is
    // a bespoke pass-through to third parties, location fees cover km/transport
    // costs that don't scale with demand. The Max €/g from Centralina applies
    // only to the rental + standard extras.
    const locationFees = Math.round((deliveryFee + pickupFee) * 100) / 100
    // Per ogni extra, Automazioni > Inclusione Coefficiente decide se entra
    // nel subtotale clamp-eligible (ON, prezzo × coefficiente) o se viene
    // sommato a listino dopo (OFF, come experience / location fees).
    const pick = (amount: number, on: boolean) => ({ inCoeff: on ? amount : 0, atList: on ? 0 : amount })
    const splitUnlimitedKm    = pick(unlimitedKmTotal,    coeffFlags.unlimited_km)
    const splitInsurance      = pick(insuranceTotal,      coeffFlags.insurance)
    const splitLavaggio       = pick(lavaggioFee,         coeffFlags.lavaggio)
    const splitNoCauzione     = pick(noCauzioneTotal,     coeffFlags.no_cauzione)
    const splitSecondDriver   = pick(secondDriverTotal,   coeffFlags.second_driver)
    const splitDr7Flex        = pick(dr7FlexTotal,        coeffFlags.dr7_flex)
    const splitCauzioneVeic   = pick(cauzioneVeicoliTotal,coeffFlags.cauzione_veicoli)
    const extrasInCoeff = splitInsurance.inCoeff + splitLavaggio.inCoeff + splitNoCauzione.inCoeff + splitUnlimitedKm.inCoeff + splitSecondDriver.inCoeff + splitDr7Flex.inCoeff + splitCauzioneVeic.inCoeff
    const extrasAtList  = splitInsurance.atList  + splitLavaggio.atList  + splitNoCauzione.atList  + splitUnlimitedKm.atList  + splitSecondDriver.atList  + splitDr7Flex.atList  + splitCauzioneVeic.atList
    const listSubtotalNoExp = listRentalTotal + extrasInCoeff
    const listSubtotal = listSubtotalNoExp + experienceCost + locationFees + extrasAtList

    // Apply revenue coefficients ONLY to the clamp-eligible portion.
    // Experience + location fees stay at LIST PRICE — no coefficient, no
    // clamp — so the price stamped on the preventivo matches the cost the
    // experience provider / transport actually charges us.
    const rawAfterRevenueNoExp = listSubtotalNoExp * revenueCoeff
    const experienceAfterCoeff = Math.round(experienceCost * 100) / 100

    // Clamp the clamp-eligible portion (rental + standard extras) against the
    // per-vehicle daily max/min from Centralina Pro. 800 €/g × 3 giorni =
    // 2400 € max for (rental + insurance + lavaggio + ecc.); experience and
    // location fees are added ON TOP afterwards.
    const minDaily = revenueData?.enabled && typeof revenueData.minPrice === 'number' ? revenueData.minPrice : null
    const maxDaily = revenueData?.enabled && typeof revenueData.maxPrice === 'number' ? revenueData.maxPrice : null
    const maxTotal = maxDaily != null ? maxDaily * rentalDays : null
    const minTotal = minDaily != null ? minDaily * rentalDays : null
    let afterRevenueTotalNoExp = rawAfterRevenueNoExp
    let clampHit: 'min' | 'max' | null = null
    if (maxTotal != null && afterRevenueTotalNoExp > maxTotal) { afterRevenueTotalNoExp = maxTotal; clampHit = 'max' }
    if (minTotal != null && afterRevenueTotalNoExp < minTotal) { afterRevenueTotalNoExp = minTotal; clampHit = 'min' }

    // Real (uncapped) subtotal for display purposes — this is the "Subtotale"
    // line the admin sees, reflecting what the engine would ask for without
    // limits. The clamp lines below show how it's been capped.
    const subtotalDisplay = Math.round((rawAfterRevenueNoExp + experienceAfterCoeff + locationFees + extrasAtList) * 100) / 100
    const subtotalClamped = Math.round((afterRevenueTotalNoExp + experienceAfterCoeff + locationFees + extrasAtList) * 100) / 100
    // Keep the legacy `afterRevenue` alias = the clamped subtotal used for all
    // downstream math (markup, sconto, totale finale).
    const afterRevenue = subtotalClamped

    // Apply maggiorazione on top
    const markupMultiplier = 1 + maggiorazione / 100
    const subtotal = Math.round(afterRevenue * markupMultiplier * 100) / 100

    // Daily rate for display: derived from the clamped total so "€X/giorno ×
    // N giorni" always adds up to the subtotal (before markup).
    const dailyFromClamped = rentalDays > 0 ? afterRevenue / rentalDays : 0
    const dailyAfterCoeff = Math.round(dailyFromClamped * markupMultiplier * 100) / 100
    const rentalTotal = Math.round(listDailyRate * rentalDays * 100) / 100
    const maggiorazioneAmount = Math.round(afterRevenue * (maggiorazione / 100) * 100) / 100

    const desiredFinal = parseFloat(form.sconto) || 0
    const sconto = desiredFinal > 0 && desiredFinal < subtotal ? Math.round((subtotal - desiredFinal) * 100) / 100 : 0
    const totalFinal = sconto > 0 ? desiredFinal : subtotal

    return {
      baseDailyRate: listDailyRate,
      maggiorazione,
      dailyAfterMarkup: dailyAfterCoeff,
      rentalTotal,
      insuranceDailyPrice,
      insuranceTotal,
      lavaggioFee,
      noCauzioneDaily,
      noCauzioneTotal,
      unlimitedKmDaily,
      unlimitedKmTotal,
      secondDriverDaily,
      secondDriverTotal,
      dr7FlexDaily,
      dr7FlexTotal,
      cauzioneVeicoliDaily,
      cauzioneVeicoliTotal,
      deliveryFee,
      pickupFee,
      experienceCost,
      experienceAfterCoeff,
      listSubtotal,
      // Subtotale a cui il coefficiente si applica davvero: esclude
      // experience e location fees (consegna + ritiro) — quelli passano
      // a listino. Il riepilogo usa questo valore per mostrare lo
      // sconto effettivo del coefficiente, evitando che la riga
      // "Coefficiente combinato" simuli uno sconto sull'intero subtotale
      // (che in realtà non viene applicato sulle fee).
      listSubtotalNoExp,
      revenueCoeff,
      revenueBreakdown: revenueData?.breakdown || [],
      // Uncapped subtotal — what the admin sees as "Subtotale" in the riepilogo.
      subtotalDisplay,
      // Clamped version (used by maggiorazione / sconto / totale finale).
      afterRevenue,
      clampHit,
      clampLimitDaily: clampHit === 'max' ? maxDaily : clampHit === 'min' ? minDaily : null,
      clampLimitTotal: clampHit === 'max' ? maxTotal : clampHit === 'min' ? minTotal : null,
      maggiorazioneAmount,
      subtotal,
      sconto,
      totalFinal,
      kmIncluded: resolveKmIncluded(selectedVehicle?.category, rentalDays, proKm, rentalConfig),
      sforo: (configOverlay as any).sforoKm ?? (configOverlay as any).sforo_km ?? 0,
    }
  }, [form, rentalDays, revenueData, selectedVehicle, insuranceOptions, configOverlay, rentalConfig, noCauzioneResolvedDaily, proLavaggioFee, proSecondDriverDaily, proDr7FlexDaily, proUnlimitedKmDaily, proKm])

  // ─── Data Loading ─────────────────────────────────────────────────────────

  useEffect(() => {
    loadPreventivi()
    loadVehicles()
    loadCustomers()
    loadNoCauzioneRequests()
  }, [])

  async function loadCustomers() {
    try {
      // Use Netlify function (service role, bypasses RLS)
      const res = await fetch('/.netlify/functions/list-customers')
      if (!res.ok) {
        console.error('[PreventiviTab] list-customers failed:', res.status)
        return
      }
      const json = await res.json()
      const raw = json.customers || json.data || json || []
      const mapped = raw.map((c: any) => {
        let fullName = ''
        if (c.tipo_cliente === 'azienda') {
          fullName = c.denominazione || `${c.nome || ''} ${c.cognome || ''}`.trim() || c.email || 'Azienda'
        } else {
          fullName = `${c.nome || ''} ${c.cognome || ''}`.trim() || c.denominazione || c.email || c.telefono || 'Cliente senza nome'
        }
        return {
          id: c.id,
          full_name: fullName,
          email: c.email || null,
          phone: c.telefono || null,
          scadenza_patente: c.scadenza_patente || null,
          data_nascita: c.data_nascita || null,
          data_rilascio_patente: c.data_rilascio_patente || c.metadata?.patente?.rilascio || c.patente_data_rilascio || null,
        }
      })
      console.log(`[PreventiviTab] Loaded ${mapped.length} customers`)
      setCustomers(mapped)
    } catch (e) {
      console.error('[PreventiviTab] loadCustomers error:', e)
    }
  }

  async function loadPreventivi() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('preventivi')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      const now = new Date()
      const updated: Preventivo[] = (data || []).map(p => {
        if (p.status === 'inviato' && p.expires_at && new Date(p.expires_at) < now) {
          supabase.from('preventivi').update({ status: 'scaduto' }).eq('id', p.id).then(() => {})
          return { ...p, status: 'scaduto' }
        }
        return p
      })
      setPreventivi(updated)
    } catch (error) {
      console.error('Failed to load preventivi:', error)
      toast.error('Errore caricamento preventivi')
    } finally {
      setLoading(false)
    }
  }

  async function loadNoCauzioneRequests() {
    setNoCauzioneLoading(true)
    try {
      const { data } = await supabase
        .from('bookings')
        .select('*')
        .contains('booking_details', { no_cauzione_request: true })
        .order('created_at', { ascending: false })
      setNoCauzioneRequests(data || [])
    } catch (err) {
      console.error('Failed to load no cauzione requests:', err)
    } finally {
      setNoCauzioneLoading(false)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function handleApproveNoCauzione(booking: any) {
    setProcessingId(booking.id)
    try {
      const custName = booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente'
      const custEmail = booking.customer_email || booking.booking_details?.customer?.email || ''
      const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone || ''
      const bookingRef = booking.id.substring(0, 8).toUpperCase()
      const totalEur = booking.price_total / 100

      const linkRes = await fetch('/.netlify/functions/nexi-pay-by-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id, amount: totalEur, customerEmail: custEmail, customerName: custName,
          description: `Prenotazione #${bookingRef} - ${booking.vehicle_name || 'Veicolo'}`,
          expirationHours: 24, paymentPurpose: 'booking',
        })
      })
      const linkData = await linkRes.json()
      if (!linkRes.ok || !linkData.paymentUrl) { toast.error('Errore generazione link: ' + (linkData.error || 'Riprova')); return }

      await supabase.from('bookings').update({
        booking_details: { ...booking.booking_details, no_cauzione_status: 'approved', nexi_payment_link: linkData.paymentUrl, nexi_order_id: linkData.orderId },
        payment_status: 'pending',
      }).eq('id', booking.id)

      if (custPhone) {
        const pickupIso = booking.pickup_date || booking.booking_details?.pickup_date || ''
        const dropoffIso = booking.dropoff_date || booking.booking_details?.dropoff_date || ''
        const fmtDate = (iso: string) => {
          if (!iso) return ''
          try {
            return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          } catch { return iso }
        }
        const rentalPeriod = pickupIso && dropoffIso ? `${fmtDate(pickupIso)} - ${fmtDate(dropoffIso)}` : ''
        const resp = await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: custPhone,
            // BUG FIX 2026-05-13: legacy key + service_type → resolver via handled_events.
            templateKey: 'no_cauzione_approved',
            booking: { service_type: 'rental' },
            templateVars: {
              '{customer_name}': custName.split(' ')[0],
              '{vehicle_name}': booking.vehicle_name || 'Veicolo',
              '{rental_period}': rentalPeriod,
              '{link}': linkData.paymentUrl,
              '{total}': `€${totalEur.toFixed(2)}`,
            },
          })
        })
        const respJson = await resp.json().catch(() => ({}))
        if (respJson?.skipped) {
          toast.error('Template per "no_cauzione_approved" non configurato in Messaggi di Sistema Pro')
        }
      }
      toast.success('Approvata! Link di pagamento inviato.')
      await loadNoCauzioneRequests()
    } catch (err: any) { toast.error('Errore: ' + (err.message || 'Riprova')) }
    finally { setProcessingId(null) }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function handleRejectNoCauzione(booking: any) {
    setProcessingId(booking.id)
    try {
      const custName = booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente'
      const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone || ''
      const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      let code = 'DR7-5%-'
      for (let i = 0; i < 4; i++) code += CHARSET[Math.floor(Math.random() * CHARSET.length)]

      await supabase.from('discount_codes').insert({
        code, scope: 'noleggio', value_type: 'percentage', value_amount: 5,
        valid_from: new Date().toISOString(), valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        single_use: true, status: 'active',
        notes: `Rifiuto no cauzione - ${custName} - Booking ${booking.id.substring(0, 8)}`,
      })

      await supabase.from('bookings').update({
        status: 'cancelled',
        booking_details: { ...booking.booking_details, no_cauzione_status: 'rejected', rejection_discount_code: code },
      }).eq('id', booking.id)

      logAdminAction('cancel_booking', 'booking', booking.id, {
        ...buildBookingContext(booking),
        reason: 'Rifiuto No Cauzione',
        discount_code: code,
      })

      if (custPhone) {
        const resp = await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: custPhone,
            // BUG FIX 2026-05-13: legacy key + service_type → resolver via handled_events.
            templateKey: 'no_cauzione_rejected',
            booking: { service_type: 'rental' },
            templateVars: {
              '{customer_name}': custName.split(' ')[0],
              '{vehicle_name}': booking.vehicle_name || 'Veicolo',
              '{reason}': `Codice sconto 5%: ${code}`,
            },
          })
        })
        const respJson = await resp.json().catch(() => ({}))
        if (respJson?.skipped) {
          toast.error('Template per "no_cauzione_rejected" non configurato in Messaggi di Sistema Pro')
        }
      }
      toast.success(`Rifiutata. Codice sconto ${code} inviato.`)
      await loadNoCauzioneRequests()
    } catch (err: any) { toast.error('Errore: ' + (err.message || 'Riprova')) }
    finally { setProcessingId(null) }
  }

  async function loadVehicles() {
    // Load ALL vehicles (including unavailable) — preventivo is a quote, not a booking
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .neq('status', 'retired')
      .order('display_name')
    setVehicles(data || [])
  }

  // Snapshot del preventivo allegato all'email OTP a direzione: cosi' la
  // direzione vede chi/cosa/quando/quanto prima di autorizzare. Usato per
  // tutte le modal OTP del preventivo (No Cauzione, slot, fuori orario).
  const otpDetails = useMemo<Array<{ label: string; value: string }>>(() => {
    const cust = customers.find((c: any) => c.id === selectedCustomerId)
    const fmtDate = (d: string, t: string) => {
      if (!d) return ''
      const [y, mo, da] = d.split('-')
      return y && mo && da ? `${da}/${mo}/${y} ${t || ''}`.trim() : `${d} ${t || ''}`.trim()
    }
    const tierLabel = form.driver_tier === 'TIER_1' ? 'Fascia B' : form.driver_tier === 'TIER_2' ? 'Fascia A' : ''
    const clienteValue = cust?.full_name || ''

    // Costruiamo righe solo con valore non vuoto — labels in italiano.
    const push = (label: string, value: string | number | null | undefined) => {
      if (value == null) return
      const s = String(value).trim()
      if (!s) return
      rows.push({ label, value: s })
    }
    const rows: Array<{ label: string; value: string }> = []
    push('Operazione', editingId ? 'Modifica preventivo' : 'Nuovo preventivo')
    if (editingId) push('Preventivo', String(editingId).slice(0, 8))
    push('Cliente', clienteValue)
    push('Telefono', cust?.phone)
    push('Veicolo', selectedVehicle ? `${selectedVehicle.display_name}${selectedVehicle.plate ? ` (${selectedVehicle.plate})` : ''}` : '')
    push('Ritiro', fmtDate(form.pickup_date, form.pickup_time))
    push('Riconsegna', fmtDate(form.return_date, form.return_time))
    push('Giorni', rentalDays > 0 ? rentalDays : null)

    // Fascia cliente — solo se il gate No Cauzione e' tra quelli scattati.
    if (combinedOtpTripped.includes('no_cauzione')) {
      push('Fascia cliente', tierLabel)
      push('Residente Sardegna', form.residente_sardegna ? 'Sì' : 'No')
      push('No Cauzione', form.include_no_cauzione ? 'Sì' : 'No')
    }

    // Importo preventivo se calcolato.
    if (pricing.totalFinal > 0) push('Importo preventivo', formatEur(pricing.totalFinal))

    // Motivazioni esplicite, una riga per gate scattato. Il valore include
    // il dettaglio reale (slot in conflitto, finestra fuori orario, ecc.)
    // così la direzione vede ESATTAMENTE cosa sta autorizzando.
    combinedOtpTripped.forEach((code, i) => {
      const msg = combinedOtpMotivazioni[i] || ''
      if (code === 'out_of_hours') push('Motivo orario', msg)
      else if (code === 'slot') push('Motivo slot', msg)
      else if (code === 'no_cauzione') push('Motivo cauzione', msg)
    })

    return rows
  }, [customers, selectedCustomerId, selectedVehicle, form, editingId, rentalDays, pricing.totalFinal, combinedOtpMotivazioni, combinedOtpTripped])

  // ─── Resume Save after OTP approval ─────────────────────────────────────
  // When an OTP gate trips during Salva, pendingSaveRef is set and the
  // matching modal is shown. Approving the OTP updates the corresponding
  // override id state; this effect notices the new id and resumes the save
  // automatically with the same `send` flag the operator originally used.
  useEffect(() => {
    if (!pendingSaveRef.current) return
    if (combinedOtpOpen) return
    const { send } = pendingSaveRef.current
    pendingSaveRef.current = null
    handleSave(send)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outOfHoursOverrideId, noCauzioneOverrideId, slotOverrideId])

  // ─── Save Preventivo ───────────────────────────────────────────────────────

  async function handleSave(sendAfterSave: boolean = false) {
    if (!form.vehicle_id || !form.pickup_date || !form.return_date) {
      toast.error('Seleziona veicolo e date')
      return
    }
    if (rentalDays < 1) {
      toast.error('Date non valide')
      return
    }
    if (sendAfterSave) {
      const cust = customers.find((c: any) => c.id === selectedCustomerId)
      if (!cust?.phone) {
        toast.error('Seleziona un cliente con numero di telefono')
        return
      }
    }

    // OTP gates — fire ONLY at Salva. Tutte e tre le condizioni vengono
    // valutate insieme; se più di una scatta apriamo UNA sola modal
    // combinata con TUTTE le motivazioni, così la direzione riceve UNA
    // email che elenca tutti i motivi reali della richiesta.
    const motivazioni: string[] = []
    const trippedCodes: TrippedCode[] = []

    // 1) Out-of-office hours on pickup or return.
    if (!outOfHoursOverrideId) {
      const pickupExc = describeException(form.pickup_date, form.pickup_time, 'pickup')
      const returnExc = describeException(form.return_date, form.return_time, 'return')
      if (pickupExc || returnExc) {
        const parts: string[] = []
        if (pickupExc) parts.push(`Ritiro: ${pickupExc}`)
        if (returnExc) parts.push(`Riconsegna: ${returnExc}`)
        motivazioni.push(`Fuori orario standard — ${parts.join(' · ')}`)
        trippedCodes.push('out_of_hours')
      }
    }

    // 2) No Cauzione for Fascia B requires direzione OTP (unless the
    //    operator is Valerio himself).
    if (form.include_no_cauzione && isFasciaB && !isValerio && !noCauzioneOverrideId) {
      motivazioni.push(`No Cauzione richiesta per cliente Fascia B (residente: ${form.residente_sardegna ? 'sì' : 'no'})`)
      trippedCodes.push('no_cauzione')
    }

    // 3) Availability guard: a preventivo reserves the slot just like a booking.
    // Blocks same-car 75-min buffer AND the 15-min cross-vehicle handover gap.
    // If blocked, the admin can override via a director OTP.
    let slotConflictReason: string | null = null
    if (selectedVehicle && !slotOverrideId) {
      const windowStart = new Date(`${form.pickup_date}T00:00:00+02:00`)
      const windowEnd = new Date(`${form.return_date}T23:59:59+02:00`)
      windowStart.setDate(windowStart.getDate() - 1)
      windowEnd.setDate(windowEnd.getDate() + 1)
      const { data: windowBookings } = await supabase
        .from('bookings')
        .select('id,vehicle_id,vehicle_plate,vehicle_name,customer_name,pickup_date,dropoff_date,status,service_type,payment_method,payment_status')
        .lt('pickup_date', windowEnd.toISOString())
        .gt('dropoff_date', windowStart.toISOString())
      const availVehicle: AvailabilityVehicle = {
        id: selectedVehicle.id,
        display_name: selectedVehicle.display_name,
        plate: selectedVehicle.plate,
        status: (selectedVehicle.status === 'available' || selectedVehicle.status === 'rented' || selectedVehicle.status === 'maintenance' || selectedVehicle.status === 'retired')
          ? selectedVehicle.status
          : 'available',
        daily_rate: selectedVehicle.daily_rate,
        category: (selectedVehicle.category as AvailabilityVehicle['category']) || undefined,
        metadata: selectedVehicle.metadata,
        created_at: '',
        updated_at: '',
      }
      const result = isVehicleAvailable(
        availVehicle,
        form.pickup_date,
        form.return_date,
        form.pickup_time,
        form.return_time,
        (windowBookings || []) as AvailabilityBooking[],
      )
      if (!result.available) {
        slotConflictReason = result.reason || 'Slot non disponibile'
        motivazioni.push(`Slot non disponibile — ${slotConflictReason}`)
        trippedCodes.push('slot')
      }
    }

    // Filtro per Gestione OTP: se un codice è disattivato in
    // system_otp_overrides (is_required=false) lo bypassiamo SILENZIOSAMENTE
    // qui — niente modal, niente email a direzione, override id sintetico
    // assegnato così il save procede subito. Disattivare un OTP nel tab
    // Gestione OTP deve realmente disattivarlo per i preventivi.
    const TRIP_CODE_TO_DB: Record<TrippedCode, string> = {
      out_of_hours: 'out_of_office_hours',
      no_cauzione: 'tier1_no_cauzione',
      slot: 'slot_unavailable',
    }
    const filteredMotivazioni: string[] = []
    const filteredTripped: TrippedCode[] = []
    trippedCodes.forEach((code, i) => {
      const dbCode = TRIP_CODE_TO_DB[code]
      if (!isOtpRequired(dbCode)) {
        // Auto-bypass: marca l'override id locale e non includere nel modal
        const bypassId = `bypass_${dbCode}_${Date.now()}_${i}`
        if (code === 'out_of_hours') setOutOfHoursOverrideId(bypassId)
        if (code === 'no_cauzione') setNoCauzioneOverrideId(bypassId)
        if (code === 'slot') {
          setSlotOverrideId(bypassId)
          setSlotUnavailableWarning('')
        }
        return
      }
      filteredMotivazioni.push(motivazioni[i])
      filteredTripped.push(code)
    })

    // Se almeno UN gate richiede ancora OTP apriamo la modal combinata con
    // tutte le motivazioni rimaste. La direzione riceve UNA sola email con
    // l'elenco completo. I gate disattivati (filtrati sopra) vengono
    // bypassati senza coinvolgere la direzione.
    if (filteredMotivazioni.length > 0) {
      setCombinedOtpMotivazioni(filteredMotivazioni)
      setCombinedOtpTripped(filteredTripped)
      pendingSaveRef.current = { send: sendAfterSave }
      setCombinedOtpOpen(true)
      return
    }

    // Tutti i gate sono OK (verificati o bypassati): se abbiamo settato un
    // override id sintetico tramite bypass dobbiamo lasciare React fare il
    // commit dello stato, poi il resume effect ri-esegue handleSave. Questo
    // path scatta solo quando NON abbiamo aperto la modal.
    if (trippedCodes.length > 0) {
      pendingSaveRef.current = { send: sendAfterSave }
      return
    }

    // All gates cleared — clear any pending save marker and persist.
    pendingSaveRef.current = null
    setSaving(true)
    try {
      const pickup = `${form.pickup_date}T${form.pickup_time}:00+02:00`
      const dropoff = `${form.return_date}T${form.return_time}:00+02:00`

      const record = {
        vehicle_id: form.vehicle_id,
        vehicle_name: selectedVehicle?.display_name || '',
        vehicle_plate: selectedVehicle?.plate || null,
        vehicle_category: selectedVehicle?.category || null,
        vehicle_model_year: form.model_year ? parseInt(form.model_year) : null,
        vehicle_cv: form.cv ? parseInt(form.cv) : null,
        vehicle_0_100: form.acceleration_0_100 ? parseFloat(form.acceleration_0_100) : null,
        pickup_date: pickup,
        dropoff_date: dropoff,
        rental_days: rentalDays,
        base_daily_rate: pricing.baseDailyRate,
        maggiorazione_pct: pricing.maggiorazione,
        daily_rate_after_markup: pricing.dailyAfterMarkup,
        insurance_option: form.insurance_option || null,
        insurance_daily_price: pricing.insuranceDailyPrice,
        insurance_total: pricing.insuranceTotal,
        lavaggio_fee: pricing.lavaggioFee,
        no_cauzione_daily: pricing.noCauzioneDaily,
        no_cauzione_total: pricing.noCauzioneTotal,
        unlimited_km_daily: pricing.unlimitedKmDaily,
        unlimited_km_total: pricing.unlimitedKmTotal,
        second_driver_daily: pricing.secondDriverDaily,
        second_driver_total: pricing.secondDriverTotal,
        subtotal: pricing.subtotal,
        sconto: pricing.sconto,
        sconto_note: form.sconto_note || null,
        total_final: pricing.totalFinal,
        driver_tier: form.driver_tier,
        pricing_trace: revenueData || null,
        extras_detail: {
          residente_sardegna: form.residente_sardegna,
          include_lavaggio: form.include_lavaggio,
          include_no_cauzione: form.include_no_cauzione,
          include_unlimited_km: form.include_unlimited_km,
          include_second_driver: form.include_second_driver,
          include_dr7_flex: form.include_dr7_flex,
          dr7_flex_daily: pricing.dr7FlexDaily,
          dr7_flex_total: pricing.dr7FlexTotal,
          include_cauzione_veicoli: form.include_cauzione_veicoli,
          cauzione_veicoli_daily: pricing.cauzioneVeicoliDaily,
          cauzione_veicoli_total: pricing.cauzioneVeicoliTotal,
          delivery_fee: pricing.deliveryFee,
          pickup_fee: pricing.pickupFee,
          pickup_location: form.pickup_location,
          dropoff_location: form.dropoff_location,
          delivery_address: form.delivery_address,
          pickup_address: form.pickup_address,
          experience_services: form.experience_services,
          experience_km_quotes: form.experience_km_quotes,
          experience_cost: pricing.experienceCost,
        },
        status: 'bozza',
        created_by: adminEmail || (await supabase.auth.getUser()).data.user?.email || null,
      }

      console.log('[PreventiviTab] Saving preventivo with created_by:', record.created_by, 'editing:', editingId)

      let data, error
      if (editingId) {
        // Update existing preventivo (don't overwrite created_by/status)
        const { created_by: _cb, status: _st, ...updateRecord } = record
        const result = await supabase
          .from('preventivi')
          .update({ ...updateRecord, updated_at: new Date().toISOString() })
          .eq('id', editingId)
          .select()
          .single()
        data = result.data
        error = result.error
      } else {
        // Insert new preventivo
        const result = await supabase
          .from('preventivi')
          .insert([record])
          .select()
          .single()
        data = result.data
        error = result.error
      }

      if (error) throw error
      toast.success(editingId ? 'Preventivo aggiornato!' : 'Preventivo salvato!')

      // Audit log
      const logDetails = {
        number: data?.id ? data.id.substring(0, 8) : null,
        customer: data?.customer_name || customers.find((c: any) => c.id === selectedCustomerId)?.full_name || null,
        phone: data?.customer_phone || customers.find((c: any) => c.id === selectedCustomerId)?.phone || null,
        vehicle: data?.vehicle_name || null,
        plate: data?.vehicle_plate || null,
        pickup_date: data?.pickup_date || null,
        dropoff_date: data?.dropoff_date || null,
        total: data?.total_final || null,
        rental_days: data?.rental_days || null,
      }
      logAdminAction(
        editingId ? 'preventivo_updated' : 'preventivo_created',
        'preventivo',
        data?.id || editingId || undefined,
        logDetails,
      )

      if (editingId) {
        setPreventivi(prev => prev.map(p => p.id === editingId ? data : p))
      } else {
        setPreventivi(prev => [data, ...prev])
      }
      const wasEditing = !!editingId
      setView('list')
      setEditingId(null)
      resetForm()

      // Send WhatsApp after save OR update — whenever the admin clicked the
      // "...e invia" CTA and the selected customer has a phone. Previously
      // this only fired on create; the edit flow silently skipped the send.
      void wasEditing // kept for readability / future diverging logic
      if (sendAfterSave && data) {
        const cust = customers.find((c: any) => c.id === selectedCustomerId)
        if (cust?.phone) {
          await handleSendWhatsApp(data, cust.phone)
        }
      }
    } catch (error: unknown) {
      console.error('Failed to save preventivo:', error)
      toast.error('Errore salvataggio preventivo')
    } finally {
      setSaving(false)
    }
  }

  function handleEdit(p: Preventivo) {
    // Extract time from ISO dates (in Europe/Rome)
    const pickupDate = new Date(p.pickup_date)
    const dropoffDate = new Date(p.dropoff_date)
    const pickupDateStr = pickupDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
    const pickupTimeStr = pickupDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
    const returnDateStr = dropoffDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
    const returnTimeStr = dropoffDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })

    const extras = (p.extras_detail || {}) as Record<string, any>

    setForm({
      vehicle_id: p.vehicle_id || '',
      pickup_date: pickupDateStr,
      pickup_time: pickupTimeStr,
      return_date: returnDateStr,
      return_time: returnTimeStr,
      driver_tier: (p.driver_tier as DriverTier) || 'TIER_2',
      residente_sardegna: extras.residente_sardegna !== undefined ? !!extras.residente_sardegna : true,
      maggiorazione_pct: String(p.maggiorazione_pct || 0),
      insurance_option: p.insurance_option || '',
      include_lavaggio: !!extras.include_lavaggio || p.lavaggio_fee > 0,
      include_no_cauzione: !!extras.include_no_cauzione || p.no_cauzione_total > 0,
      include_unlimited_km: !!extras.include_unlimited_km || p.unlimited_km_total > 0,
      include_second_driver: !!extras.include_second_driver || p.second_driver_total > 0,
      include_dr7_flex: !!extras.include_dr7_flex,
      include_cauzione_veicoli: !!extras.include_cauzione_veicoli || Number(extras.cauzione_veicoli_total || 0) > 0,
      pickup_location: extras.pickup_location || 'dr7_office',
      dropoff_location: extras.dropoff_location || 'dr7_office',
      delivery_fee: String(extras.delivery_fee || 0),
      pickup_fee: String(extras.pickup_fee || 0),
      delivery_address: extras.delivery_address || '',
      pickup_address: extras.pickup_address || '',
      experience_services: extras.experience_services || {},
      experience_km_quotes: (extras.experience_km_quotes || {}) as KmQuoteMap,
      sconto: p.sconto > 0 ? String(p.total_final) : '',
      sconto_note: p.sconto_note || 'valido solo 24h',
      model_year: p.vehicle_model_year ? String(p.vehicle_model_year) : '',
      cv: p.vehicle_cv ? String(p.vehicle_cv) : '',
      acceleration_0_100: p.vehicle_0_100 ? String(p.vehicle_0_100) : '',
    })
    setEditingId(p.id)
    setView('form')
  }

  function resetForm() {
    setForm({
      vehicle_id: '',
      pickup_date: '',
      pickup_time: '10:30',
      return_date: '',
      return_time: '09:00', // default: pickup 10:30 − 1h30 = 09:00
      driver_tier: 'TIER_2',
      residente_sardegna: true,
      maggiorazione_pct: String(configOverlay.maggiorazionePct),
      insurance_option: '',
      include_lavaggio: true,
      include_no_cauzione: false,
      include_unlimited_km: false,
      include_second_driver: false,
      include_dr7_flex: false,
      include_cauzione_veicoli: false,
      pickup_location: 'dr7_office',
      dropoff_location: 'dr7_office',
      delivery_fee: '0',
      pickup_fee: '0',
      delivery_address: '',
      pickup_address: '',
      experience_services: {},
      experience_km_quotes: {},
      sconto: '',
      sconto_note: 'valido solo 24h',
      model_year: '',
      cv: '',
      acceleration_0_100: '',
    })
    setRevenueData(null)
    // Reset No-Cauzione approval when form is reset
    setNoCauzioneOverrideId(null)
    // Reset slot-availability override
    setSlotOverrideId(null)
    setSlotUnavailableWarning('')
    // Reset out-of-hours override
    setOutOfHoursOverrideId(null)
    // Close any combined OTP modal still open from a previous session
    setCombinedOtpOpen(false)
    setCombinedOtpMotivazioni([])
    setCombinedOtpTripped([])
    pendingSaveRef.current = null
    draftSessionIdRef.current = crypto.randomUUID()
  }

  // ─── No-Cauzione guard ────────────────────────────────────────────────────
  // Fascia B + non-Valerio still needs OTP, but the modal is opened only at
  // Salva — checking the box mid-form must not interrupt the operator.

  const isFasciaB = form.driver_tier === 'TIER_1'

  function handleNoCauzioneToggle(nextChecked: boolean) {
    if (!nextChecked) {
      setForm(prev => ({ ...prev, include_no_cauzione: false }))
      setNoCauzioneOverrideId(null)
      return
    }
    setForm(prev => ({ ...prev, include_no_cauzione: true }))
  }

  // ─── WhatsApp Send ──────────────────────────────────────────────────────

  /** Build a coefficienti-only message: just the breakdown lines + the
   *  combined multiplier, no pricing/specs/discount. Used when the admin
   *  ticks "Invia SOLO i coefficienti" — the client asked for the math. */
  function buildCoefficientiOnlyMessage(p: Preventivo): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trace = (p.pricing_trace || {}) as any
    const traceBreakdown: { label: string; coeff: number; description?: string }[] =
      Array.isArray(trace.breakdown) ? trace.breakdown : []
    if (!trace.enabled || traceBreakdown.length === 0) return ''
    const combined = traceBreakdown.reduce((acc, b) => acc * (Number(b?.coeff) || 1), 1)
    const fmtCoeff = (n: number) => {
      const s = n.toFixed(4).replace('.', ',').replace(/,?0+$/, '')
      return `x${s || '1'}`
    }
    const lines = traceBreakdown.map(b => {
      const cleanLabel = String(b.label || '').replace(/^Coefficienti\s+/i, '')
      const desc = b.description ? ` (${b.description})` : ''
      return `- ${cleanLabel}${desc}: ${fmtCoeff(Number(b.coeff) || 1)}`
    })
    const header = `*Coefficienti applicati ${p.vehicle_name ? '— ' + p.vehicle_name : ''}*`.trim()
    let msg = `${header}\n\n${lines.join('\n')}\n\n*Coefficiente combinato:* ${fmtCoeff(combined)}`
    const footer = rentalConfig?.preventivi?.whatsapp_footer
    if (footer) msg += `\n\n${footer}`
    return msg
  }

  async function formatWhatsAppMessage(p: Preventivo, opts?: { includeCoefficienti?: boolean; coefficientiOnly?: boolean }): Promise<string> {
    // "Solo coefficienti" short-circuits the template loader entirely.
    if (opts?.coefficientiOnly) {
      return buildCoefficientiOnlyMessage(p)
    }
    const optIncludeCoefficienti = opts?.includeCoefficienti ?? false
    // Due template gestiti dall'admin in Messaggi di Sistema Pro, identificati
    // per LABEL (non per key) perché creati tramite "Aggiungi template" e
    // quindi salvati sotto chiavi pro_custom_<slug>_<timestamp>:
    //   sconto > 0  → label "Preventivo WhatsApp"
    //   sconto = 0  → label "Preventivo senza sconto"
    // Nessun fallback: se il template non esiste o è disattivato, torniamo
    // '' e il chiamante mostra un toast d'errore col nome esatto del template.
    const hasSconto = (p.sconto || 0) > 0
    const targetLabel = hasSconto ? 'Preventivo WhatsApp' : 'Preventivo senza sconto'

    try {
      // Scope: SOLO righe visibili in Messaggi di Sistema Pro (key pro_%),
      // così escludiamo i seed legacy (preventivo_whatsapp, ecc.) che hanno
      // la stessa label ma non sono editabili dall'admin. Match per label
      // case-insensitive perché gli admin spesso riciclano entry del catalogo
      // (es. pro_promemoria_checkout rinominato "Preventivo senza sconto").
      const { data: rows } = await supabase
        .from('system_messages')
        .select('message_body, is_enabled, updated_at')
        .ilike('label', targetLabel)
        .like('message_key', 'pro_%')
        .order('updated_at', { ascending: false })
      const tpl = (rows || []).find(r => r.is_enabled !== false && r.message_body) || null

      if (tpl?.is_enabled && tpl.message_body) {
        // Resolve insurance options and user-intent flags from the preventivo
        // itself (not from the form), because this function is called from the
        // list where the form may be empty or on a different vehicle.
        const pVehicle = vehicles.find(v => v.id === p.vehicle_id)
        const pInsOpts = getInsuranceOptionsForVehicle(
          pVehicle,
          (p.driver_tier as DriverTier) || 'TIER_2',
          configOverlay,
          rentalConfig
        )
        const extras = p.extras_detail as Record<string, unknown> | null
        const pickedUnlimitedKm = !!extras?.include_unlimited_km || p.unlimited_km_total > 0
        // Resolve full customer record (email + phone) by customer_id when present.
        // Falls back to whatever is denormalized on the preventivo row.
        const pCustomer = p.customer_id
          ? customers.find((c) => c.id === p.customer_id)
          : null
        const customerEmail = (pCustomer?.email as string) || ''
        const customerPhone = (pCustomer?.phone as string) || p.customer_phone || ''
        const customerFirstName = (p.customer_name || '').trim().split(/\s+/)[0] || ''

        // Vehicle specs fallback: preventivi creati senza compilare i campi
        // (cv / 0-100 / anno) hanno NULL su quelle colonne. Cadiamo allora
        // su vehicle.metadata.* della tabella vehicles, dove VehiclesTab
        // memorizza i dati tecnici. Tutti i nuovi preventivi vengono salvati
        // con i campi compilati, ma la fallback copre le righe storiche.
        const meta = (pVehicle?.metadata || {}) as { cv?: unknown; model_year?: unknown; acceleration_0_100?: unknown }
        const metaCv = meta.cv != null ? Number(meta.cv) : null
        const metaYear = meta.model_year != null ? Number(meta.model_year) : null
        const metaZeroToHundred = meta.acceleration_0_100 != null ? Number(meta.acceleration_0_100) : null
        const cv = p.vehicle_cv ?? (Number.isFinite(metaCv) ? metaCv : null)
        const modelYear = p.vehicle_model_year ?? (Number.isFinite(metaYear) ? metaYear : null)
        const zeroToHundred = p.vehicle_0_100 ?? (Number.isFinite(metaZeroToHundred) ? metaZeroToHundred : null)

        // Build variables for substitution
        const specs = [
          p.vehicle_name,
          modelYear ? `my ${modelYear}` : '',
          cv ? `${cv}cv` : '',
          zeroToHundred ? `0-100 ${String(zeroToHundred).replace('.', ',')}s` : '',
        ].filter(Boolean).join(' ')

        const resolveInsLabel = () =>
          pInsOpts.find(i => i.id === p.insurance_option)?.label
          || (p.insurance_option ? String(p.insurance_option) : 'Kasko')

        // Build each pricing line independently so the template can reference
        // them one at a time (e.g. {rental_line}, {km_line}, ...) and skip
        // anything it doesn't want. Each is empty when not applicable, so an
        // unused line collapses cleanly. The legacy {pricing_lines} placeholder
        // joins all non-empty lines with \n for templates that still use it.
        const giornoLabel = p.rental_days === 1 ? 'giorno' : 'giorni'
        const lineRental = `${p.rental_days} ${giornoLabel} — ${formatEur(p.base_daily_rate)}/giorno = ${formatEur((p.base_daily_rate) * p.rental_days)}`
        const lineInsurance = (p.insurance_option && p.insurance_total >= 0)
          ? `${resolveInsLabel()} = ${formatEur(p.insurance_total)}` : ''
        const lineLavaggio = p.lavaggio_fee > 0 ? `Lavaggio Finale = ${formatEur(p.lavaggio_fee)}` : ''
        const lineNoCauzione = p.no_cauzione_total > 0 ? `No cauzione = ${formatEur(p.no_cauzione_total)}` : ''
        const lineKm = (() => {
          if (pickedUnlimitedKm) {
            return p.unlimited_km_total > 0
              ? `Km illimitati = ${formatEur(p.unlimited_km_total)}`
              : `Km illimitati = Incluso`
          }
          // Checkbox NON spuntato = nessuna riga km, ne' "Km Illimitati"
          // ne' "Km inclusi". L'utente vuole che la riga compaia SOLO
          // quando ha esplicitamente scelto km illimitati.
          return ''
        })()
        const lineSecondDriver = p.second_driver_total > 0
          ? `Secondo guidatore = ${formatEur(p.second_driver_total)}` : ''
        const lineDr7Flex = (extras?.dr7_flex_total && Number(extras.dr7_flex_total) > 0)
          ? `DR7 Flex = ${formatEur(Number(extras.dr7_flex_total))}` : ''
        const lineCauzioneVeicoli = (extras?.cauzione_veicoli_total && Number(extras.cauzione_veicoli_total) > 0)
          ? `Cauzione veicolo = ${formatEur(Number(extras.cauzione_veicoli_total))}` : ''
        const lineDelivery = (extras?.delivery_fee && Number(extras.delivery_fee) > 0)
          ? `Consegna = ${formatEur(Number(extras.delivery_fee))}` : ''
        const linePickup = (extras?.pickup_fee && Number(extras.pickup_fee) > 0)
          ? `Ritiro = ${formatEur(Number(extras.pickup_fee))}` : ''
        const lineExperience = (extras?.experience_cost && Number(extras.experience_cost) > 0)
          ? `Servizi experience = ${formatEur(Number(extras.experience_cost))}` : ''

        const pricingLines = [
          lineRental, lineInsurance, lineLavaggio, lineNoCauzione, lineKm,
          lineSecondDriver, lineDr7Flex, lineCauzioneVeicoli,
          lineDelivery, linePickup, lineExperience,
        ].filter(Boolean).join('\n')

        // Sconto split in pezzi atomici cosi' il template puo' comporre la
        // riga come preferisce (es. "Sconto 15% (€285) valido 24h: €1.290").
        const scontoAmount = Number(p.sconto || 0)
        const scontoPre = Number(p.subtotal || 0)
        const scontoPost = Number(p.total_final || p.subtotal || 0)
        const scontoPerc = scontoAmount > 0 && scontoPre > 0
          ? Math.round((scontoAmount / scontoPre) * 100)
          : 0
        const scontoNote = (p.sconto_note || '').trim()

        let discountLine = ''
        if (scontoAmount > 0) discountLine = `sconto ${scontoNote} ${formatEur(scontoPost)}`.replace(/\s+/g, ' ').trim()

        // Coefficienti Centralina Pro: leggiamo dal pricing_trace salvato al
        // momento della creazione del preventivo. Mostriamo TUTTI i coefficienti
        // (anche quelli neutri = x1) e il moltiplicatore combinato risultante.
        const trace = (p.pricing_trace || {}) as {
          enabled?: boolean
          breakdown?: { label: string; coeff: number; description?: string }[]
        }
        const traceBreakdown = Array.isArray(trace.breakdown) ? trace.breakdown : []
        const combinedCoeff = traceBreakdown.reduce((acc, b) => acc * (Number(b?.coeff) || 1), 1)
        const fmtCoeff = (n: number) => {
          const s = n.toFixed(4).replace('.', ',').replace(/,?0+$/, '')
          return `x${s || '1'}`
        }
        let coefficientiBlock = ''
        // Admin opt-in: only render the coefficienti block when the checkbox
        // in the send modal is ticked. Default OFF — most clients don't want
        // to see the internal pricing math.
        if (optIncludeCoefficienti && trace.enabled && traceBreakdown.length > 0) {
          const lines = traceBreakdown.map(b => {
            const cleanLabel = String(b.label || '').replace(/^Coefficienti\s+/i, '')
            const desc = b.description ? ` (${b.description})` : ''
            return `- ${cleanLabel}${desc}: ${fmtCoeff(Number(b.coeff) || 1)}`
          })
          coefficientiBlock = `Coefficienti applicati:\n${lines.join('\n')}\nCoefficiente combinato: ${fmtCoeff(combinedCoeff)}`
        }
        const coefficienteCombinatoStr = (optIncludeCoefficienti && trace.enabled) ? fmtCoeff(combinedCoeff) : ''

        const vars: Record<string, string> = {
          vehicle_specs: specs,
          vehicle_name: p.vehicle_name || '',
          // Anno modello in formato compatto "MY2024" (vuoto se mancante).
          vehicle_year: modelYear ? `MY${modelYear}` : '',
          // Specs senza nome veicolo: "440 CV • 0-100 km/h in 3,9s".
          vehicle_specs_short: [
            cv ? `${cv} CV` : '',
            zeroToHundred ? `0-100 km/h in ${String(zeroToHundred).replace('.', ',')}s` : '',
          ].filter(Boolean).join(' • '),
          rental_days: String(p.rental_days),
          daily_rate: formatEur(p.base_daily_rate),
          rental_total: formatEur((p.base_daily_rate) * p.rental_days),
          // Per-line placeholders — usali al posto di {pricing_lines} per
          // controllare quali voci appaiono nel messaggio. Vuoto se la voce
          // non si applica (es. lavaggio non incluso).
          rental_line: lineRental,
          insurance_line: lineInsurance,
          lavaggio_line: lineLavaggio,
          no_cauzione_line: lineNoCauzione,
          km_line: lineKm,
          second_driver_line: lineSecondDriver,
          dr7_flex_line: lineDr7Flex,
          cauzione_veicoli_line: lineCauzioneVeicoli,
          delivery_line: lineDelivery,
          pickup_line: linePickup,
          experience_line: lineExperience,
          pricing_lines: pricingLines,
          // Subtotale listino: somma di tutte le voci a prezzo di listino,
          // PRIMA dell'applicazione dei coefficienti della Centralina Pro.
          // Usare in Messaggi di Sistema Pro come placeholder {subtotal_listino}.
          subtotal_listino: formatEur(
            (p.base_daily_rate || 0) * (p.rental_days || 1)
            + Number(p.insurance_total || 0)
            + Number(p.lavaggio_fee || 0)
            + Number(p.no_cauzione_total || 0)
            + Number(p.unlimited_km_total || 0)
            + Number(p.second_driver_total || 0)
            + Number(extras?.dr7_flex_total || 0)
            + Number(extras?.cauzione_veicoli_total || 0)
            + Number(extras?.delivery_fee || 0)
            + Number(extras?.pickup_fee || 0)
            + Number(extras?.experience_cost || 0)
          ),
          subtotal: formatEur(p.subtotal),
          total: formatEur(p.total_final || p.subtotal),
          // Sconto — variabili granulari (admin compone la riga nel template).
          // {sconto} resta la riga pronta come prima per retrocompatibilita'.
          // {sconto_post} e' SEMPRE valorizzato (anche senza sconto) cosi'
          // lo stesso template puo' funzionare in entrambi gli scenari:
          // con sconto = "prezzo dopo sconto", senza sconto = "prezzo
          // finale". Le altre {sconto_*} restano vuote senza sconto, cosi'
          // una riga tipo "Sconto X% (Y) Z: W" collassa naturalmente.
          sconto: discountLine,
          sconto_line: discountLine,
          sconto_amount: scontoAmount > 0 ? formatEur(scontoAmount) : '',
          sconto_perc: scontoPerc > 0 ? `${scontoPerc}%` : '',
          sconto_note: scontoNote,
          sconto_pre: scontoAmount > 0 ? formatEur(scontoPre) : '',
          sconto_post: formatEur(scontoPost),
          // Alias non-"sconto" — usali nei template "Preventivo senza sconto"
          // per evitare la parola "sconto" nel nome variabile.
          prezzo_finale: formatEur(scontoPost),
          prezzo: formatEur(scontoPost),
          prezzo_listino: formatEur(scontoPre || scontoPost),
          // Centralina Pro: blocco multilinea con tutti i coefficienti
          // applicati al preventivo + il moltiplicatore combinato.
          coefficienti: coefficientiBlock,
          // Solo il moltiplicatore combinato (es. "x1,2143"), per template
          // che vogliono una riga sintetica.
          coefficiente_combinato: coefficienteCombinatoStr,
          customer_name: p.customer_name || '',
          // Pickup / dropoff date-time — Europe/Rome, split into date and time slots
          // so the Pro template placeholders {pickup_date}, {pickup_time},
          // {dropoff_date}, {dropoff_time} all resolve.
          pickup_date: p.pickup_date
            ? new Date(p.pickup_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
            : '',
          pickup_time: p.pickup_date
            ? new Date(p.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
            : '',
          dropoff_date: p.dropoff_date
            ? new Date(p.dropoff_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
            : '',
          dropoff_time: p.dropoff_date
            ? new Date(p.dropoff_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
            : '',
          // Checkbox non spuntato: nessuna info km, qualunque sia il
          // default della categoria.
          km_info: pickedUnlimitedKm ? 'Illimitati' : '',
          // {km_illimitati} -> "Km Illimitati = X,XX" (stesso formato delle
          // altre voci: "Lavaggio Finale = 9,90", "No cauzione = 49,00").
          // Mostrata SOLO se l'utente ha esplicitamente spuntato Km
          // Illimitati (pickedUnlimitedKm). Niente checkbox = niente riga,
          // anche se la categoria del veicolo ha default 'unlimited'.
          km_illimitati: (() => {
              if (!pickedUnlimitedKm) return ''
              const cost = Number(p.unlimited_km_total || 0)
              return cost > 0 ? `Km Illimitati = ${formatEur(cost)}` : 'Km Illimitati = Incluso'
          })(),
          unlimited_km: (() => {
              if (!pickedUnlimitedKm) return ''
              const cost = Number(p.unlimited_km_total || 0)
              return cost > 0 ? `Km Illimitati = ${formatEur(cost)}` : 'Km Illimitati = Incluso'
          })(),
          // Importo grezzo, senza label: per template che vogliono mostrare
          // l'importo separatamente dalla label.
          km_illimitati_importo: (pickedUnlimitedKm && Number(p.unlimited_km_total || 0) > 0)
              ? formatEur(Number(p.unlimited_km_total || 0))
              : '',
          // {km_package} -> riepilogo del/i servizio/i Servizi Extra con unit
          // "al km (quota manuale)" che l'operatore ha quotato in questo
          // preventivo. Formato coerente con le altre voci della legenda
          // ("Lavaggio Finale = 9,90", "Km Illimitati = 500,00", ecc.):
          // "<NomeServizio> <km> Km = <importo>".
          // Vuoto se nessun servizio al-km e' stato configurato — la riga
          // collassa automaticamente come per le altre voci opzionali.
          km_package: (() => {
            const quotes = (extras?.experience_km_quotes || {}) as Record<string, { km?: number; pricePerKm?: number }>
            const lines: string[] = []
            for (const [id, q] of Object.entries(quotes)) {
              const km = Number(q?.km || 0)
              const ppk = Number(q?.pricePerKm || 0)
              if (km <= 0 || ppk <= 0) continue
              const total = Math.round(km * ppk * 100) / 100
              const svc = (configOverlay.experienceServices || []).find(s => s.id === id)
              const label = svc?.name || 'Pacchetto KM'
              lines.push(`${label} ${km} Km = ${formatEur(total)}`)
            }
            return lines.join('\n')
          })(),
          // Luogo di ritiro/riconsegna — se "domicilio" usa l'indirizzo custom,
          // altrimenti usa la label dell'ufficio/aeroporto.
          // pickup_location  → dove il cliente ritira (consegna a casa = delivery_address)
          // dropoff_location → dove il cliente riconsegna (ritiriamo a casa = pickup_address)
          pickup_location: (() => {
            const loc = String(extras?.pickup_location || 'dr7_office')
            if (loc === 'domicilio') return String(extras?.delivery_address || 'Domicilio')
            return LOCATIONS.find(l => l.value === loc)?.label || loc
          })(),
          dropoff_location: (() => {
            const loc = String(extras?.dropoff_location || 'dr7_office')
            if (loc === 'domicilio') return String(extras?.pickup_address || 'Domicilio')
            return LOCATIONS.find(l => l.value === loc)?.label || loc
          })(),
          // Cliente — variabili "common" del catalogo Messaggi di Sistema Pro.
          nome: customerFirstName,
          cliente: p.customer_name || '',
          customer_email: customerEmail,
          customer_phone: customerPhone,
          // Veicolo & Servizio — alias documentati nella legenda common.
          plate: p.vehicle_plate || '',
          targa: p.vehicle_plate || '',
          // Preventivi noleggio non hanno un service_name (riservato a lavaggio/meccanica).
          service_name: '',
          servizio: '',
          // Booking ref — preventivi usano l'id breve (8 char) come prefisso DR7.
          booking_id: p.id ? `DR7-${String(p.id).substring(0, 8).toUpperCase()}` : '',
          booking_ref: p.id ? `DR7-${String(p.id).substring(0, 8).toUpperCase()}` : '',
          bookingRef: p.id ? `DR7-${String(p.id).substring(0, 8).toUpperCase()}` : '',
          // Date (calendar style) — preventivi noleggio non hanno un singolo
          // appuntamento; lasciamo le date/orario di ritiro come default
          // sensato per i template che usano {date}/{time}.
          date: p.pickup_date
            ? new Date(p.pickup_date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })
            : '',
          time: p.pickup_date
            ? new Date(p.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
            : '',
          // Assicurazione — nome leggibile (es. "Kasko Black"). La riga formattata
          // resta {insurance_line}.
          insurance: resolveInsLabel(),
          // Preventivi noleggio non hanno notes operative — vuoto per default
          // (admin puo' sovrascrivere via system_message_variables se serve).
          notes: '',
          note: '',
          nota: '',
          // Stato pagamento / cauzione — non applicabili a un preventivo
          // (nessun pagamento ricevuto ancora), si lasciano vuoti cosi'
          // la riga collassa se presente nel template.
          payment_status: '',
          pagamento: '',
          payment_info: '',
          deposit: '',
        }

        // CUSTOM VARIABLES — pre-load enabled rows da system_message_variables
        // e mergea PRIMA delle vars locali (locali vincono in caso di collisione).
        // Cosi' {address_main} / {promo_ferragosto} / qualunque variabile custom
        // definita dall'admin funziona anche nei preventivi (non solo nei
        // template inviati via send-whatsapp-notification).
        let allVars: Record<string, string> = {}
        try {
          const { data: customVars } = await supabase
            .from('system_message_variables')
            .select('key, value, is_enabled')
            .eq('is_enabled', true)
          if (Array.isArray(customVars)) {
            for (const row of customVars) {
              const k = String((row as { key?: unknown }).key || '').trim()
              const v = String((row as { value?: unknown }).value ?? '')
              if (k) allVars[k] = v
            }
          }
        } catch (e) {
          console.error('[PreventiviTab] custom vars load failed (non-fatal):', e)
        }
        // Vars locali del preventivo vincono
        allVars = { ...allVars, ...vars }

        let msg = tpl.message_body
        for (const [k, v] of Object.entries(allVars)) {
          const value = v || ''
          // Se la variabile e' VUOTA e occupa una riga da sola (eventualmente
          // con bullet "•", "-", "*" o whitespace circostante), rimuovi la
          // riga intera + il bullet residuo. Esempi che vengono strippati:
          //   "{km_illimitati}"
          //   "  {km_illimitati}  "
          //   "• {km_illimitati}"
          //   "- {km_illimitati}"
          //   "*{km_illimitati}*"
          if (value === '') {
            msg = msg.replace(new RegExp(`^[ \\t]*[•\\-\\*]?[ \\t]*\\*?\\{${k}\\}\\*?[ \\t]*\\n?`, 'gm'), '')
          }
          // Substitution standard per gli altri pattern (inline o leftover).
          msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), value)
        }
        // Safety net: any placeholder still in the message wasn't built and
        // wasn't defined in system_message_variables. Strip the entire line
        // when it stands alone (same logic as the per-var empty-line cleanup),
        // otherwise replace the leftover `{key}` inline with an empty string.
        // Prevents future legenda additions from rendering as literal "{key}".
        msg = msg
          .replace(/^[ \t]*[•\-\*]?[ \t]*\*?\{[a-zA-Z0-9_]+\}\*?[ \t]*\n?/gm, '')
          .replace(/\{[a-zA-Z0-9_]+\}/g, '')

        // Clean up: collapse 3+ newlines into 2 (preserva paragraph breaks)
        msg = msg.replace(/\n{3,}/g, '\n\n').trim()

        const footer = rentalConfig?.preventivi?.whatsapp_footer
        if (footer) msg += `\n\n${footer}`

        return msg
      }
    } catch (err) {
      console.error('[PreventiviTab] Errore lettura template preventivo:', err)
    }

    // Template mancante/disabilitato: nessun fallback hardcoded.
    return ''
  }

  async function handleSendWhatsApp(preventivo: Preventivo, phone: string, messageOverride?: string) {
    setSendingWhatsapp(true)
    try {
      const message = messageOverride && messageOverride.trim()
        ? messageOverride
        : await formatWhatsAppMessage(preventivo)

      if (!message.trim()) {
        toast.error('Messaggio vuoto: compila "Conferma Preventivo Inviato" in Messaggi di Sistema Pro')
        return
      }

      const response = await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPhone: phone, customMessage: message, skipHeader: true })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Errore invio WhatsApp')

      // Coefficienti-only flow: do NOT change the preventivo status,
      // do NOT touch expires_at — it's a follow-up note, not the
      // preventivo itself going out.
      const isCoefficientiOnly = includeCoefficienti
      const selectedCust = customers.find((c: any) => c.id === selectedCustomerId)

      if (isCoefficientiOnly) {
        appendPreventivoEvent(preventivo.id, 'coefficienti_inviati', { detail: `${phone} - ${selectedCust?.full_name || preventivo.customer_name || ''}` })
        logAdminAction('preventivo_coefficienti_sent', 'preventivo', preventivo.id, {
          number: preventivo.id.substring(0, 8),
          customer: selectedCust?.full_name || preventivo.customer_name || null,
          phone,
          vehicle: preventivo.vehicle_name,
        })
        toast.success('Coefficienti inviati al cliente')
      } else {
        const expiryHours = configOverlay.defaultExpiryHours || 24
        const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString()

        await supabase
          .from('preventivi')
          .update({
            status: 'inviato',
            customer_phone: phone,
            customer_name: selectedCust?.full_name || preventivo.customer_name || null,
            customer_id: selectedCustomerId || preventivo.customer_id || null,
            sent_by: adminEmail || null,
            whatsapp_sent_at: new Date().toISOString(),
            whatsapp_message_id: result.messageId || null,
            expires_at: expiresAt,
          })
          .eq('id', preventivo.id)

        appendPreventivoEvent(preventivo.id, 'preventivo_inviato', { detail: `${phone} - ${selectedCust?.full_name || ''}` })
        logAdminAction('preventivo_sent', 'preventivo', preventivo.id, {
          number: preventivo.id.substring(0, 8),
          customer: selectedCust?.full_name || preventivo.customer_name || null,
          phone,
          vehicle: preventivo.vehicle_name,
          plate: preventivo.vehicle_plate,
          total: preventivo.total_final,
          rental_days: preventivo.rental_days,
        })
        toast.success('Preventivo inviato via WhatsApp!')
      }

      setShowPhoneModal(false)
      setWhatsappPhone('')
      setSelectedCustomerId('')
      setIncludeCoefficienti(false)
      loadPreventivi()
    } catch (error: unknown) {
      console.error('WhatsApp send error:', error)
      toast.error('Errore invio WhatsApp')
    } finally {
      setSendingWhatsapp(false)
    }
  }

  // ─── Accept (was: Convert to Booking) ──────────────────────────────────
  // Old flow navigated to a separate booking form. Now: opens a small modal
  // (PreventivoAcceptModal) that collects customer + payment method and
  // creates the booking inline. No-cauzione preventivi from non-Valerio
  // admins are still gated to a WhatsApp approval request.

  function gateNoCauzioneApproval(preventivo: Preventivo): boolean {
    if (preventivo.source !== 'website_no_cauzione') return false
    if (isValerio) return false
    const msg = `*RICHIESTA APPROVAZIONE NO CAUZIONE*\n\n`
      + `*Admin:* ${adminEmail}\n`
      + `*Cliente:* ${preventivo.customer_name || 'N/A'}\n`
      + `*Telefono:* ${preventivo.customer_phone || 'N/A'}\n`
      + `*Veicolo:* ${preventivo.vehicle_name}\n`
      + `*Totale:* €${(preventivo.total_final || 0).toFixed(2)}\n\n`
      + `Approva o rifiuta dal pannello admin > Preventivi.`

    // Fire-and-forget: look up the admin-configured boss phone, then send.
    getBossPhone().then(bossPhone => {
      fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPhone: bossPhone, customMessage: msg }),
      }).catch(() => {})
    })

    toast.success('Richiesta approvazione inviata a Valerio')
    return true
  }

  async function handleRejectNoCauzionePreventivo(preventivo: Preventivo) {
    // Generate 5% discount code
    const code = `DR7-5%-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
    const customerName = preventivo.customer_name || 'Cliente'
    const firstName = customerName.split(' ')[0]

    // Create the discount code in the database so it actually works at checkout
    const validUntil = new Date()
    validUntil.setDate(validUntil.getDate() + 7) // valid for 7 days
    await supabase.from('discount_codes').insert({
      code,
      code_type: 'codice_sconto',
      scope: ['tutti'],
      value_type: 'percentage',
      value_amount: 5,
      valid_from: new Date().toISOString(),
      valid_until: validUntil.toISOString(),
      single_use: true,
      message: `Sconto 5% per rifiuto no cauzione — ${customerName}`,
      status: 'active',
    })

    // Update status
    await supabase.from('preventivi').update({ status: 'rifiutato' }).eq('id', preventivo.id)

    // Send rejection WhatsApp to customer
    if (preventivo.customer_phone) {
      const subtotal = Number(preventivo.subtotal || preventivo.total_final || 0)
      const totalAfter = Math.max(0, subtotal * 0.95)
      const eur = (n: number) => `€${n.toFixed(2)}`
      fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customPhone: preventivo.customer_phone,
          // BUG FIX 2026-05-13: legacy key + service_type → resolver via handled_events.
          templateKey: 'quote_discount_offered',
          booking: { service_type: 'rental' },
          templateVars: {
            '{customer_name}': firstName,
            '{vehicle_name}': preventivo.vehicle_name || 'Veicolo',
            '{discount_percent}': '5',
            '{total_before}': eur(subtotal),
            '{total_after}': eur(totalAfter),
            '{link}': code,
          },
        }),
      })
        .then(r => r.json().catch(() => ({})))
        .then((respJson: any) => {
          if (respJson?.skipped) {
            toast.error('Template per "quote_discount_offered" non configurato in Messaggi di Sistema Pro')
          }
        })
        .catch(() => {})
    }

    appendPreventivoEvent(preventivo.id, 'no_cauzione_rifiutato', { detail: `discount_code: ${code}` })
    logAdminAction('preventivo_rejected', 'preventivo', preventivo.id, {
      number: preventivo.id.substring(0, 8),
      customer: preventivo.customer_name,
      phone: preventivo.customer_phone,
      vehicle: preventivo.vehicle_name,
      reason: 'no_cauzione non disponibile',
      discount_code: code,
    })
    toast.success(`Rifiutato — codice sconto ${code} inviato al cliente`)
    loadPreventivi()
  }

  function openRejectModal(p: Preventivo) {
    // No setState here → no re-render of the 121+ row list. The modal listens
    // to a window CustomEvent and opens itself via its own internal state.
    openPreventivoRejectModal({ id: p.id, vehicle_name: p.vehicle_name })
  }

  function openAcceptModal(p: Preventivo) {
    if (gateNoCauzioneApproval(p)) return
    openPreventivoAcceptModal({
      id: p.id,
      vehicle_name: p.vehicle_name,
      pickup_date: p.pickup_date,
      dropoff_date: p.dropoff_date,
      total_final: p.total_final ?? null,
      customer_phone: p.customer_phone ?? null,
    })
  }

  async function confirmAccept(args: {
    preventivo: { id: string; vehicle_name: string; pickup_date: string; dropoff_date: string; total_final: number | null }
    customer_id: string
    payment_method: string
    payment_status: 'pending' | 'paid'
    amount_paid_eur: number
  }) {
    const { preventivo, customer_id, payment_method, payment_status, amount_paid_eur } = args

    const p = preventivi.find(x => x.id === preventivo.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = customers.find((x: any) => x.id === customer_id)
    if (!p || !c) {
      throw new Error('Preventivo o cliente non trovato in cache')
    }

    const customerName = c.full_name || `${c.nome || ''} ${c.cognome || ''}`.trim() || c.ragione_sociale || 'Cliente'
    const customerEmail = c.email || ''
    const customerPhone = c.telefono || c.phone || p.customer_phone || ''

    // bookings.price_total stores cents (INTEGER); convert from euros.
    const eurToCents = (eur: number) => Math.round((eur || 0) * 100)
    const totalCents = eurToCents(p.total_final ?? 0)
    const paidCents = payment_status === 'paid' ? totalCents : eurToCents(amount_paid_eur)

    const bookingPayload = {
      // user_id satisfies the bookings_user_or_guest_check constraint
      // (existing ConvertPreventivoModal does the same).
      user_id: customer_id,
      vehicle_id: p.vehicle_id,
      vehicle_name: p.vehicle_name,
      vehicle_plate: p.vehicle_plate,
      pickup_date: p.pickup_date,
      dropoff_date: p.dropoff_date,
      price_total: totalCents,
      currency: 'EUR',
      status: payment_status === 'paid' ? 'confirmed' : 'pending',
      payment_status,
      payment_method,
      amount_paid: paidCents,
      service_type: 'rental',
      booking_source: 'admin',
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      booking_details: {
        from_preventivo: p.id,
        source: 'admin_preventivo_accept',
        customer: {
          fullName: customerName,
          email: customerEmail,
          phone: customerPhone,
          id: customer_id,
          customerId: customer_id,
        },
        amountPaid: paidCents,
        insurance_option: p.insurance_option,
        rental_days: p.rental_days,
        unlimited_km: (p.unlimited_km_total || 0) > 0,
        no_cauzione: (p.no_cauzione_total || 0) > 0,
        include_lavaggio: (p.lavaggio_fee || 0) > 0,
        driver_tier: p.driver_tier,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      booked_at: new Date().toISOString(),
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('bookings')
      .insert(bookingPayload)
      .select('id')
      .single()
    if (insertErr) throw new Error(`Creazione prenotazione fallita: ${insertErr.message}`)

    const preventivoUpdate: Record<string, unknown> = {
      status: 'accettato',
      booking_id: inserted?.id,
      customer_name: customerName,
      updated_at: new Date().toISOString(),
    }
    let { error: updErr } = await supabase
      .from('preventivi')
      .update({ ...preventivoUpdate, customer_id })
      .eq('id', p.id)
    if (updErr && /customer_id/i.test(updErr.message)) {
      const retry = await supabase.from('preventivi').update(preventivoUpdate).eq('id', p.id)
      updErr = retry.error
    }
    if (updErr) {
      console.warn('[Preventivi] Booking creato ma update preventivo fallito:', updErr.message)
    }

    appendPreventivoEvent(p.id, 'preventivo_convertito', { detail: inserted?.id || '' })
    logAdminAction('preventivo_accepted', 'preventivo', p.id, {
      booking_id: inserted?.id,
      vehicle: p.vehicle_name,
      customer: customerName,
      payment_method,
      payment_status,
      amount_paid_eur,
      total: p.total_final,
    })

    // If admin chose Pay by Link Nexi, generate it and send to customer via
    // WhatsApp using the same flow as ReservationsTab "Da saldare".
    if (payment_method === 'Pay by Link Nexi' && payment_status === 'pending' && inserted?.id) {
      try {
        const totalEur = p.total_final ?? 0
        const remainingEur = Math.max(0, totalEur - amount_paid_eur)
        if (remainingEur <= 0) {
          toast('Totale gia\' coperto: nessun link generato.')
        } else {
          const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: inserted.id,
              amount: remainingEur,
              customerEmail,
              customerName,
              description: `Noleggio DR7 - ${p.vehicle_name} - ${customerName}`,
              expirationHours: 1,
            }),
          })
          const linkData = await linkRes.json().catch(() => ({} as Record<string, unknown>))

          if (linkRes.ok && (linkData as { paymentUrl?: string }).paymentUrl) {
            const paymentUrl = (linkData as { paymentUrl: string }).paymentUrl
            const orderId = (linkData as { orderId?: string }).orderId
            const expiresAt = (linkData as { expiresAt?: string }).expiresAt
            // Update booking_details with link info (same shape as ReservationsTab)
            await supabase.from('bookings').update({
              booking_details: {
                ...bookingPayload.booking_details,
                nexi_payment_link: paymentUrl,
                nexi_order_id: orderId || null,
                payment_link_expires_at: expiresAt || null,
                payment_link_created_at: new Date().toISOString(),
              }
            }).eq('id', inserted.id)

            if (!customerPhone) {
              toast(`Link generato ma cliente senza numero: ${paymentUrl}`, { duration: 12000 })
            } else {
              const waRes = await fetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  customPhone: customerPhone,
                  templateKey: 'payment_link_customer',
                  templateVars: {
                    '{customer_name}': customerName,
                    '{nome}': customerName.split(' ')[0] || 'Cliente',
                    '{booking_id}': inserted.id.substring(0, 8).toUpperCase(),
                    '{booking_ref}': inserted.id.substring(0, 8).toUpperCase(),
                    '{total}': remainingEur.toFixed(2),
                    '{amount}': remainingEur.toFixed(2),
                    '{importo}': remainingEur.toFixed(2),
                    '{payment_link}': paymentUrl,
                    '{link}': paymentUrl,
                    '{expiry}': '1 ora',
                  }
                })
              })
              const waJson = await waRes.json().catch(() => ({} as Record<string, unknown>))
              const skipped = (waJson as { skipped?: boolean }).skipped
              if (skipped) {
                toast.error('Link creato ma template "payment_link_customer" mancante in Messaggi di Sistema Pro — non inviato.', { duration: 10000 })
              } else if (!waRes.ok) {
                toast.error(`Link creato ma invio WhatsApp fallito: ${(waJson as { message?: string }).message || waRes.status}`, { duration: 10000 })
              } else {
                toast.success('Pay by Link generato e inviato al cliente via WhatsApp')
              }
            }
          } else {
            const errMsg = (linkData as { error?: string; message?: string }).error || (linkData as { message?: string }).message || `HTTP ${linkRes.status}`
            toast.error('Errore generazione Pay by Link: ' + errMsg, { duration: 10000 })
          }
        }
      } catch (linkErr: unknown) {
        const msg = linkErr instanceof Error ? linkErr.message : String(linkErr)
        toast.error('Errore Pay by Link: ' + msg, { duration: 10000 })
      }
    }

    loadPreventivi()
    toast.success(`Prenotazione creata · ${customerName}`)
  }

  async function confirmReject(args: { preventivo: { id: string; vehicle_name: string }; motivo: 'cauzione' | 'prezzo'; note: string }) {
    const updates: Record<string, unknown> = {
      status: 'rifiutato',
      motivo_rifiuto: args.motivo,
    }
    if (args.note.trim()) updates.motivo_rifiuto_note = args.note.trim()
    const { error } = await supabase.from('preventivi').update(updates).eq('id', args.preventivo.id)
    if (error) {
      toast.error(`Errore: ${error.message}`)
      return
    }
    loadPreventivi()
    toast.success(`Preventivo rifiutato (motivo: ${args.motivo})`)
  }

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }
  const sortArrow = (field: typeof sortField) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  const filtered = useMemo(() => {
    const list = (statusFilter === 'all' || statusFilter === '__no_cauzione__') ? preventivi : preventivi.filter(p => p.status === statusFilter)
    return [...list].sort((a, b) => {
      let va: any, vb: any
      if (sortField === 'created_at' || sortField === 'pickup_date') {
        va = new Date(a[sortField] || 0).getTime(); vb = new Date(b[sortField] || 0).getTime()
      } else {
        va = a[sortField] || 0; vb = b[sortField] || 0
      }
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [preventivi, statusFilter, sortField, sortDir]
  )

  // ─── RENDER ─────────────────────────────────────────────────────────────

  // ═══ LIST VIEW ═══
  if (view === 'list') {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-2xl font-bold text-theme-text-primary">Preventivi</h2>
          <Button onClick={() => { resetForm(); setEditingId(null); setView('form') }}>+ Nuovo Preventivo</Button>
        </div>

        {/* Subtab Switch */}
        {(() => {
          const pendingCount = noCauzioneRequests.filter((b: any) => b.booking_details?.no_cauzione_status === 'pending').length
          return (
            <div className="flex gap-1 bg-theme-bg-tertiary rounded-lg p-1">
              <button onClick={() => setStatusFilter('all')} className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${statusFilter !== '__no_cauzione__' ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}>
                Preventivi ({preventivi.length})
              </button>
              <button onClick={() => setStatusFilter('__no_cauzione__')} className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors relative ${statusFilter === '__no_cauzione__' ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}>
                Richieste No Cauzione
                {pendingCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-red-500 text-white font-bold">{pendingCount}</span>}
              </button>
            </div>
          )
        })()}

        {/* ═══ NO CAUZIONE SUBTAB ═══ */}
        {statusFilter === '__no_cauzione__' && (
          <div className="space-y-3">
            {noCauzioneLoading ? (
              <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold"></div></div>
            ) : noCauzioneRequests.length === 0 ? (
              <p className="text-theme-text-muted text-center py-8">Nessuna richiesta No Cauzione</p>
            ) : (
              noCauzioneRequests.map((b: any) => {
                const status = b.booking_details?.no_cauzione_status || 'pending'
                const custName = b.customer_name || b.booking_details?.customer?.fullName || 'N/A'
                const custPhone = b.customer_phone || b.booking_details?.customer?.phone || ''
                const totalEur = (b.price_total / 100).toFixed(2)
                const pickup = b.pickup_date ? new Date(b.pickup_date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '-'
                const dropoff = b.dropoff_date ? new Date(b.dropoff_date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '-'
                const createdAt = b.created_at ? new Date(b.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
                return (
                  <div key={b.id} className={`rounded-lg border p-4 ${status === 'pending' ? 'border-yellow-500/30 bg-yellow-900/10' : status === 'approved' ? 'border-green-500/30 bg-green-900/10' : 'border-red-500/30 bg-red-900/10'}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : status === 'approved' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                            {status === 'pending' ? 'In attesa' : status === 'approved' ? 'Approvata' : 'Rifiutata'}
                          </span>
                          <span className="font-semibold text-theme-text-primary">{custName}</span>
                          {custPhone && <span className="text-sm text-theme-text-muted">{custPhone}</span>}
                        </div>
                        <div className="text-sm text-theme-text-muted mt-1">
                          <span className="font-medium text-theme-text-primary">{b.vehicle_name}</span>
                          <span className="mx-2">•</span>{pickup} → {dropoff}
                          <span className="mx-2">•</span><span className="font-bold text-dr7-gold">€{totalEur}</span>
                        </div>
                        <div className="text-xs text-theme-text-muted mt-1">
                          Richiesta: {createdAt}
                          {b.booking_details?.rejection_discount_code && <span className="ml-2 text-red-400">Codice: {b.booking_details.rejection_discount_code}</span>}
                        </div>
                      </div>
                      {status === 'pending' && (
                        <div className="flex gap-2">
                          <button onClick={() => handleApproveNoCauzione(b)} disabled={processingId === b.id}
                            className="px-4 py-2 text-sm rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium disabled:opacity-50 transition-colors">
                            {processingId === b.id ? '...' : 'Approva'}
                          </button>
                          <button onClick={() => handleRejectNoCauzione(b)} disabled={processingId === b.id}
                            className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium disabled:opacity-50 transition-colors">
                            {processingId === b.id ? '...' : 'Rifiuta'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ═══ PREVENTIVI LIST ═══ */}
        {statusFilter !== '__no_cauzione__' && <>
        <div className="flex flex-wrap gap-2">
          {['all', 'bozza', 'inviato', 'accettato', 'rifiutato', 'scaduto'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${
                statusFilter === s
                  ? 'bg-dr7-gold text-white'
                  : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
              }`}
            >
              {s === 'all' ? 'Tutti' : STATUS_LABELS[s]} ({s === 'all' ? preventivi.length : preventivi.filter(p => p.status === s).length})
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold"></div>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-theme-text-muted text-center py-8">Nessun preventivo</p>
        ) : (
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-border text-left text-theme-text-muted">
                  <th className="py-2 px-3">Veicolo</th>
                  <th className="py-2 px-3 cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('created_at')}>Creato il{sortArrow('created_at')}</th>
                  <th className="py-2 px-3 cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('pickup_date')}>Date Noleggio{sortArrow('pickup_date')}</th>
                  <th className="py-2 px-3 cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('rental_days')}>Giorni{sortArrow('rental_days')}</th>
                  <th className="py-2 px-3 text-right">Subtotale</th>
                  <th className="py-2 px-3 text-right cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('total_final')}>Prezzo Scontato{sortArrow('total_final')}</th>
                  <th className="py-2 px-3">Stato</th>
                  <th className="py-2 px-3">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b border-theme-border/50 hover:bg-theme-bg-hover/30">
                    <td className="py-2 px-3">
                      <div className="font-medium text-theme-text-primary">
                        {p.vehicle_name}
                        {p.source === 'website_no_cauzione' && (
                          <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-600 text-white uppercase">No Cauzione</span>
                        )}
                        {p.source === 'website' && (
                          <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-500/20 text-blue-400">SITO</span>
                        )}
                      </div>
                      {p.customer_name && (
                        <div className="text-xs text-theme-text-muted flex items-center gap-1.5 flex-wrap">
                          <span>{p.customer_name} {p.customer_phone ? `· ${p.customer_phone}` : ''}</span>
                          <ClientStatusBadge phone={p.customer_phone} />
                        </div>
                      )}
                      {!p.customer_name && p.customer_phone && (
                        <div className="text-xs text-theme-text-muted flex items-center gap-1.5 flex-wrap">
                          <span>{p.customer_phone}</span>
                          <ClientStatusBadge phone={p.customer_phone} />
                        </div>
                      )}
                      {p.vehicle_plate && <div className="text-xs text-theme-text-muted">{p.vehicle_plate}</div>}
                      <div className="text-[10px] mt-1 space-y-0.5">
                        {p.created_by && (
                          <div className="text-theme-text-muted/60">Creato da: <span className="text-theme-text-muted">{p.created_by}</span> · {new Date(p.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}</div>
                        )}
                        {!p.created_by && (
                          <div className="text-theme-text-muted/60">Creato il: {new Date(p.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}</div>
                        )}
                        {p.whatsapp_sent_at && (
                          <div className="text-green-400/80">Inviato{p.sent_by ? ` da ${p.sent_by}` : ''} → {p.customer_name ? `${p.customer_name}${p.customer_phone ? ` (${p.customer_phone})` : ''}` : p.customer_phone || 'N/A'} · {new Date(p.whatsapp_sent_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}</div>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-theme-text-muted font-mono leading-relaxed bg-theme-bg-tertiary/50 rounded p-2 max-w-xs space-y-0.5">
                        <div>{p.vehicle_name}{p.vehicle_model_year ? ` · my ${p.vehicle_model_year}` : ''}</div>
                        <div>{p.rental_days}gg × {formatEur(p.base_daily_rate)}/g</div>
                        <div>Totale: <span className="text-theme-text-primary">{formatEur(p.total_final || p.subtotal)}</span></div>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-theme-text-muted text-xs">
                      {new Date(p.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}
                    </td>
                    <td className="py-2 px-3 text-theme-text-muted">
                      {new Date(p.pickup_date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}
                      {' - '}
                      {new Date(p.dropoff_date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}
                    </td>
                    <td className="py-2 px-3 text-theme-text-muted">{p.rental_days}gg</td>
                    <td className="py-2 px-3 text-right text-theme-text-muted">{formatEur(p.subtotal)}</td>
                    <td className="py-2 px-3 text-right font-bold text-theme-text-primary">{p.sconto > 0 ? formatEur(p.total_final) : '-'}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status] || 'bg-gray-600'}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1 flex-wrap">
                        {/* Preventivi site-created: Modifica e Invia disponibili come per
                            quelli creati da admin (direzione vuole poter correggere il
                            preventivo del sito prima di inviarlo al cliente). Accetta /
                            Rifiuta restano in primo piano. */}
                        {p.source?.startsWith('website') && (p.status === 'bozza' || p.status === 'inviato') ? (
                          <>
                            <button
                              onClick={() => openAcceptModal(p)}
                              className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded font-bold"
                            >
                              Accetta
                            </button>
                            {p.source === 'website_no_cauzione' ? (
                              <button
                                onClick={() => handleRejectNoCauzionePreventivo(p)}
                                className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded"
                              >
                                Rifiuta + Sconto 5%
                              </button>
                            ) : (
                              <button
                                onClick={() => openRejectModal(p)}
                                className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded"
                              >
                                Rifiuta
                              </button>
                            )}
                            <button
                              onClick={() => handleEdit(p)}
                              className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded"
                            >
                              Modifica
                            </button>
                            <button
                              onClick={async () => {
                                setSelectedPreventivo(p);
                                setWhatsappPhone(p.customer_phone || '');
                                setPreviewMessage('');
                                setIncludeCoefficienti(false);
                                const preview = await formatWhatsAppMessage(p, { includeCoefficienti: false })
                                if (!preview) {
                                  const which = (p.sconto || 0) > 0 ? '"Preventivo WhatsApp"' : '"Preventivo senza sconto"'
                                  toast.error(`Template ${which} vuoto o disattivato in Messaggi di Sistema Pro. Compilalo prima di inviare.`)
                                  return
                                }
                                setPreviewMessage(preview)
                                setShowPhoneModal(true);
                              }}
                              className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded"
                            >
                              Invia
                            </button>
                          </>
                        ) : (
                          <>
                            {(p.status === 'bozza' || p.status === 'inviato' || p.status === 'accettato') && (
                              <button
                                onClick={() => handleEdit(p)}
                                className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded"
                              >
                                Modifica
                              </button>
                            )}
                            {(p.status === 'bozza' || p.status === 'inviato') && (
                              <button
                                onClick={async () => {
                                  setSelectedPreventivo(p);
                                  setWhatsappPhone(p.customer_phone || '');
                                  setPreviewMessage('');
                                  setIncludeCoefficienti(false);
                                  const preview = await formatWhatsAppMessage(p, { includeCoefficienti: false })
                                  if (!preview) {
                                    const which = (p.sconto || 0) > 0 ? '"Preventivo WhatsApp"' : '"Preventivo senza sconto"'
                                    toast.error(`Template ${which} vuoto o disattivato in Messaggi di Sistema Pro. Compilalo prima di inviare.`)
                                    return
                                  }
                                  setPreviewMessage(preview)
                                  setShowPhoneModal(true);
                                }}
                                className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded"
                              >
                                Invia
                              </button>
                            )}
                            {/* "Invia coefficienti" — visible on EVERY row regardless
                                of status. Pre-checks the box and pre-fills the
                                preview with the coefficienti-only payload. */}
                            <button
                              onClick={async () => {
                                setSelectedPreventivo(p)
                                setWhatsappPhone(p.customer_phone || '')
                                setPreviewMessage('')
                                const preview = await formatWhatsAppMessage(p, { coefficientiOnly: true })
                                if (!preview) {
                                  toast.error('Nessun coefficiente disponibile per questo preventivo (Centralina Pro disabilitata o trace mancante).')
                                  return
                                }
                                setIncludeCoefficienti(true)
                                setPreviewMessage(preview)
                                setShowPhoneModal(true)
                              }}
                              className="px-2 py-1 text-xs bg-purple-700 hover:bg-purple-600 text-white rounded"
                              title="Invia al cliente solo la ripartizione dei coefficienti applicati"
                            >
                              Invia coefficienti
                            </button>
                            {(p.status === 'inviato' || p.status === 'bozza') && (
                              <button
                                onClick={() => openAcceptModal(p)}
                                className="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded"
                              >
                                Accetta
                              </button>
                            )}
                            {p.status === 'inviato' && (
                              <button
                                onClick={() => openRejectModal(p)}
                                className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded"
                              >
                                Rifiutato
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile list — iOS-style grouped cards (< 640px). Reuses the same
            filtered array; keeps desktop table above untouched. Every action
            the desktop Azioni column exposes is mirrored as a pill button in
            the card footer so admins can Modifica / Invia / Converti /
            Rifiutato without a desktop. */}
        {!loading && filtered.length > 0 && (
          <div className="sm:hidden space-y-2">
            {filtered.map(p => {
              const statusTone: Record<string, string> = {
                bozza: 'bg-gray-500/15 text-gray-400',
                inviato: 'bg-blue-500/15 text-blue-400',
                accettato: 'bg-green-500/15 text-green-500',
                rifiutato: 'bg-red-500/15 text-red-400',
                scaduto: 'bg-amber-500/15 text-amber-500',
              }
              const canEdit = p.status === 'bozza' || p.status === 'inviato' || p.status === 'accettato'
              const canSend = p.status === 'bozza' || p.status === 'inviato'
              const canConvert = p.status === 'bozza' || p.status === 'inviato'
              const canReject = p.status === 'bozza' || p.status === 'inviato' || p.status === 'accettato' || p.status === 'scaduto'
              const canEditMotivo = p.status === 'rifiutato'
              return (
                <div
                  key={p.id}
                  className="bg-theme-bg-tertiary/60 rounded-2xl p-4 border border-theme-border/60"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[15px] font-semibold text-theme-text-primary truncate">{p.vehicle_name}</span>
                        {p.source === 'website_no_cauzione' && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-600 text-white uppercase tracking-wide">No Cauzione</span>
                        )}
                        {p.source === 'website' && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-500/20 text-blue-400">SITO</span>
                        )}
                      </div>
                      {p.customer_name && (
                        <div className="text-[12px] text-theme-text-muted truncate flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{p.customer_name}{p.customer_phone ? ` · ${p.customer_phone}` : ''}</span>
                          <ClientStatusBadge phone={p.customer_phone} />
                        </div>
                      )}
                      {!p.customer_name && p.customer_phone && <div className="text-[12px] text-theme-text-muted">{p.customer_phone}</div>}
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${statusTone[p.status] || 'bg-gray-500/15 text-gray-400'}`}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-[1fr_auto] gap-y-1 gap-x-3 text-[12px]">
                    <span className="text-theme-text-muted">Noleggio</span>
                    <span className="text-theme-text-primary tabular-nums">
                      {new Date(p.pickup_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' })}
                      {' → '}
                      {new Date(p.dropoff_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' })}
                      <span className="text-theme-text-muted ml-1">· {p.rental_days}gg</span>
                    </span>
                    <span className="text-theme-text-muted">Subtotale</span>
                    <span className="text-theme-text-primary tabular-nums">{formatEur(p.subtotal)}</span>
                    <span className="text-theme-text-muted">{p.sconto > 0 ? 'Scontato' : 'Totale'}</span>
                    <span className="text-dr7-gold font-semibold tabular-nums">{formatEur(p.total_final)}</span>
                  </div>

                  {/* Action row — mirrors the desktop Azioni column, gated by
                      the same status rules. Wraps onto a second row when
                      needed so every button stays a full 44pt tap target. */}
                  {/* Always render the action row — "Invia coefficienti" lives
                      here regardless of other gates so it's reachable on every
                      preventivo (bozza/inviato/accettato/rifiutato/scaduto). */}
                  {(
                    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-theme-border/40">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleEdit(p)}
                          className="flex-1 min-w-[48%] h-10 rounded-lg bg-blue-600 hover:bg-blue-500 active:opacity-70 text-white text-[13px] font-semibold"
                        >
                          Modifica
                        </button>
                      )}
                      {canSend && (
                        <button
                          type="button"
                          onClick={async () => {
                            setSelectedPreventivo(p)
                            setWhatsappPhone(p.customer_phone || '')
                            setPreviewMessage('')
                            setIncludeCoefficienti(false)
                            const preview = await formatWhatsAppMessage(p, { includeCoefficienti: false })
                            if (!preview) {
                              const which = (p.sconto || 0) > 0 ? '"Preventivo WhatsApp"' : '"Preventivo senza sconto"'
                              toast.error(`Template ${which} vuoto o disattivato in Messaggi di Sistema Pro. Compilalo prima di inviare.`)
                              return
                            }
                            setPreviewMessage(preview)
                            setShowPhoneModal(true)
                          }}
                          className="flex-1 min-w-[48%] h-10 rounded-lg bg-green-600 hover:bg-green-500 active:opacity-70 text-white text-[13px] font-semibold"
                        >
                          Invia
                        </button>
                      )}
                      {/* "Invia coefficienti" — visible on EVERY card. */}
                      <button
                        type="button"
                        onClick={async () => {
                          setSelectedPreventivo(p)
                          setWhatsappPhone(p.customer_phone || '')
                          setPreviewMessage('')
                          const preview = await formatWhatsAppMessage(p, { coefficientiOnly: true })
                          if (!preview) {
                            toast.error('Nessun coefficiente disponibile per questo preventivo (Centralina Pro disabilitata o trace mancante).')
                            return
                          }
                          setIncludeCoefficienti(true)
                          setPreviewMessage(preview)
                          setShowPhoneModal(true)
                        }}
                        className="flex-1 min-w-[48%] h-10 rounded-lg bg-purple-600 hover:bg-purple-500 active:opacity-70 text-white text-[13px] font-semibold"
                        title="Invia al cliente solo la ripartizione dei coefficienti applicati"
                      >
                        Invia coefficienti
                      </button>
                      {canConvert && (
                        <button
                          type="button"
                          onClick={() => openAcceptModal(p)}
                          className="flex-1 min-w-[48%] h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:opacity-70 text-white text-[13px] font-semibold"
                        >
                          Accetta
                        </button>
                      )}
                      {canReject && (
                        <button
                          type="button"
                          onClick={() => openRejectModal(p)}
                          className="flex-1 min-w-[48%] h-10 rounded-lg bg-red-600 hover:bg-red-500 active:opacity-70 text-white text-[13px] font-semibold"
                        >
                          Rifiuta
                        </button>
                      )}
                      {canEditMotivo && (
                        <button
                          type="button"
                          onClick={() => openRejectModal(p)}
                          className="flex-1 min-w-[48%] h-10 rounded-lg bg-amber-600 hover:bg-amber-500 active:opacity-70 text-white text-[13px] font-semibold"
                          title={p.motivo_rifiuto ? `Motivo attuale: ${p.motivo_rifiuto}` : 'Imposta motivo rifiuto'}
                        >
                          {p.motivo_rifiuto ? `Motivo: ${p.motivo_rifiuto}` : 'Imposta motivo'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        </>}

        {/* Phone Modal — iOS-style sheet on mobile, centred card on desktop.
            Structure: sticky header + scrollable body + sticky action bar so
            the action buttons are always reachable even when the preview is
            very long. */}
        {showPhoneModal && selectedPreventivo && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60">
            <div className="bg-theme-bg-secondary w-full sm:max-w-md sm:mx-4 sm:rounded-2xl rounded-t-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh]">
              {/* Sticky header */}
              <div className="shrink-0 px-5 pt-4 pb-3 border-b border-theme-border flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[17px] font-semibold text-theme-text-primary">Invia Preventivo via WhatsApp</h3>
                  <p className="text-[12px] text-theme-text-muted truncate">{selectedPreventivo.vehicle_name} · {formatEur(selectedPreventivo.total_final)}</p>
                </div>
                <button
                  type="button"
                  aria-label="Chiudi"
                  onClick={() => { setShowPhoneModal(false); setWhatsappPhone('') }}
                  className="shrink-0 w-8 h-8 rounded-full bg-theme-bg-tertiary text-theme-text-muted flex items-center justify-center text-[18px] leading-none active:opacity-60"
                >
                  ×
                </button>
              </div>

              {/* Scrollable body — all form content lives here */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Cerca Cliente</label>
                  <CustomerAutocomplete
                    customers={customers}
                    selectedCustomerId={selectedCustomerId}
                    onSelectCustomer={(id) => {
                      setSelectedCustomerId(id)
                      const c = customers.find((c: any) => c.id === id)
                      if (c?.phone) setWhatsappPhone(c.phone)
                    }}
                    placeholder="Nome, email o telefono..."
                    required={false}
                  />
                </div>

                <Input
                  label="Numero di Telefono"
                  type="tel"
                  value={whatsappPhone}
                  onChange={(e) => setWhatsappPhone(e.target.value)}
                  placeholder="393xxxxxxxxx"
                />

                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Messaggio (modificabile prima dell'invio)</label>
                  <textarea
                    value={previewMessage}
                    onChange={(e) => setPreviewMessage(e.target.value)}
                    rows={10}
                    className="w-full bg-theme-bg-primary rounded p-3 text-xs text-theme-text-primary whitespace-pre-wrap font-mono focus:outline-none focus:ring-1 focus:ring-dr7-gold resize-y"
                  />
                  <p className="text-[11px] text-theme-text-muted mt-1">
                    Template caricato da {(selectedPreventivo.sconto || 0) > 0 ? '"Preventivo WhatsApp"' : '"Preventivo senza sconto"'} in Messaggi di Sistema Pro.
                  </p>

                  {/* Invia SOLO i coefficienti — sostituisce completamente
                      il messaggio normale con il solo blocco coefficienti.
                      Usato quando il cliente chiede esplicitamente la
                      ripartizione dei coefficienti applicati. */}
                  <label className="mt-3 flex items-start gap-2 cursor-pointer text-xs text-theme-text-secondary select-none">
                    <input
                      type="checkbox"
                      checked={includeCoefficienti}
                      onChange={async (e) => {
                        const next = e.target.checked
                        setIncludeCoefficienti(next)
                        const refreshed = next
                          ? await formatWhatsAppMessage(selectedPreventivo, { coefficientiOnly: true })
                          : await formatWhatsAppMessage(selectedPreventivo)
                        if (next && !refreshed) {
                          toast.error('Nessun coefficiente disponibile per questo preventivo (Centralina Pro disabilitata o trace mancante).')
                          setIncludeCoefficienti(false)
                          return
                        }
                        if (refreshed) setPreviewMessage(refreshed)
                      }}
                      className="mt-0.5 accent-dr7-gold"
                    />
                    <span>
                      <span className="font-medium text-theme-text-primary">Invia SOLO i coefficienti</span>
                      <span className="block text-[11px] text-theme-text-muted">
                        Sostituisce il messaggio con la sola ripartizione dei coefficienti Centralina Pro applicati al preventivo. Da usare quando il cliente chiede esplicitamente il dettaglio.
                      </span>
                    </span>
                  </label>

                  <label className="block text-sm font-medium text-theme-text-secondary mt-3 mb-1">Anteprima formattata</label>
                  <div
                    className="w-full bg-theme-bg-primary rounded p-3 text-xs text-theme-text-primary whitespace-pre-wrap break-words"
                    dangerouslySetInnerHTML={{ __html: renderWhatsAppHtml(previewMessage) }}
                  />
                </div>
              </div>

              {/* Sticky action bar — always reachable */}
              <div className="shrink-0 px-5 py-3 border-t border-theme-border bg-theme-bg-secondary flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                <Button variant="secondary" className="w-full sm:w-auto" onClick={() => { setShowPhoneModal(false); setWhatsappPhone('') }}>
                  Annulla
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={!whatsappPhone.trim() || !previewMessage.trim() || sendingWhatsapp}
                  onClick={() => handleSendWhatsApp(selectedPreventivo, whatsappPhone.trim(), previewMessage)}
                >
                  {sendingWhatsapp ? 'Invio...' : 'Invia WhatsApp'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal motivo rifiuto — mounted in list view so CustomEvent listener
            is active when user clicks "Rifiutato" from this view */}
        <PreventivoRejectModal onConfirm={confirmReject} />
        <PreventivoAcceptModal onConfirm={confirmAccept} customers={customers} />
      </div>
    )
  }

  // ═══ FORM VIEW (Nuovo / Modifica Preventivo) ═══
  return (
    // Desktop layout unchanged. Mobile: sticky top nav + inline action row
    // at the end of the form (no fixed bottom bar — too fragile across
    // different webview/drawer layouts).
    <div className="space-y-6">
      {/* Mobile iOS-style nav bar (< 640px) */}
      <div className="sm:hidden sticky top-0 -mx-4 px-4 py-3 bg-theme-bg-primary/90 backdrop-blur-md border-b border-theme-border z-30 flex items-center justify-between">
        <button
          type="button"
          onClick={() => { setView('list'); setEditingId(null); resetForm() }}
          className="flex items-center gap-1 text-[15px] text-dr7-gold active:opacity-60"
        >
          <svg width="11" height="18" viewBox="0 0 11 18" fill="none" aria-hidden="true">
            <path d="M10 1L2 9L10 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Lista</span>
        </button>
        <div className="text-[17px] font-semibold text-theme-text-primary truncate">
          {editingId ? 'Modifica' : 'Nuovo Preventivo'}
        </div>
        <div className="w-[60px]" aria-hidden="true" />
      </div>

      {/* Desktop header (≥ 640px) */}
      <div className="hidden sm:flex items-center justify-between">
        <h2 className="text-2xl font-bold text-theme-text-primary">{editingId ? 'Modifica Preventivo' : 'Nuovo Preventivo'}</h2>
        <Button variant="secondary" onClick={() => { setView('list'); setEditingId(null); resetForm() }}>Torna alla Lista</Button>
      </div>

      {/* Vehicle + Fascia/Customer combined dropdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Veicolo *"
          value={form.vehicle_id}
          onChange={(e) => {
            const newId = e.target.value
            const v = vehicles.find(x => x.id === newId)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const m = (v?.metadata || {}) as any
            // Auto-popola le specs dalla scheda veicolo (Veicoli > metadata)
            // cosi' i placeholder {vehicle_year}/{vehicle_specs_short}/{vehicle_specs}
            // sono sempre pieni nel preventivo. Se l'admin vuole ridefinirli,
            // puo' editare i campi a mano sotto.
            setForm(prev => ({
              ...prev,
              vehicle_id: newId,
              insurance_option: '',
              model_year: m.model_year != null ? String(m.model_year) : prev.model_year,
              cv: m.cv != null ? String(m.cv) : prev.cv,
              acceleration_0_100: m.acceleration_0_100 != null ? String(m.acceleration_0_100) : prev.acceleration_0_100,
            }))
          }}
          options={[
            { value: '', label: 'Seleziona veicolo...' },
            ...vehicles.map(v => ({ value: v.id, label: `${v.display_name}${v.plate ? ` (${v.plate})` : ''}${v.status === 'maintenance' ? ' [Manutenzione]' : ''}` }))
          ]}
        />
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-2">Fascia Cliente</label>
          <Select
            value={form.driver_tier}
            onChange={(e) => setForm(prev => ({ ...prev, driver_tier: e.target.value as DriverTier, insurance_option: '' }))}
            options={[
              { value: 'TIER_2', label: 'Fascia A (26-69, patente 5+ anni)' },
              { value: 'TIER_1', label: 'Fascia B (21-25 o patente 3-4 anni)' },
            ]}
          />
          <div className="mt-2 flex gap-2">
            {([true, false] as const).map(val => (
              <button
                key={String(val)}
                type="button"
                onClick={() => setForm(prev => ({ ...prev, residente_sardegna: val }))}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                  form.residente_sardegna === val
                    ? 'bg-dr7-gold text-white'
                    : 'bg-theme-bg-tertiary text-theme-text-muted border border-theme-border hover:border-theme-text-muted'
                }`}
              >
                {val ? 'Residente Sardegna' : 'Non Residente'}
              </button>
            ))}
          </div>
          <div className="mt-2">
            <CustomerAutocomplete
              customers={customers}
              selectedCustomerId={selectedCustomerId}
              onSelectCustomer={(id) => {
                setSelectedCustomerId(id)
                if (!id) { setTierReason(''); return }
                const c = customers.find((x: any) => x.id === id)
                if (!c?.data_nascita || !c?.data_rilascio_patente) {
                  setTierReason('Dati mancanti — imposta fascia manualmente')
                  return
                }
                try {
                  const age = calculateAge(c.data_nascita)
                  const licYears = calculateLicenseYears(c.data_rilascio_patente)
                  const tier = classifyDriverTier(age, licYears)
                  if (tier.tier === 'BLOCKED') {
                    setTierReason(`⚠️ Cliente non idoneo: ${tier.reason}`)
                    return
                  }
                  setForm(prev => ({ ...prev, driver_tier: tier.tier as DriverTier, insurance_option: '' }))
                  const fasciaLabel = tier.tier === 'TIER_2' ? 'A' : 'B'
                  setTierReason(`✓ Fascia ${fasciaLabel} auto (età ${age}, patente ${licYears} anni)`)
                } catch {
                  setTierReason('')
                }
              }}
              placeholder="Cerca cliente per auto-impostare Fascia..."
              required={false}
            />
            {tierReason && (
              <div className={`mt-1 text-xs ${tierReason.startsWith('⚠️') ? 'text-red-400' : tierReason.includes('mancanti') ? 'text-amber-400' : 'text-green-400'}`}>
                {tierReason}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Vehicle Specs */}
      {selectedVehicle && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-theme-bg-tertiary/50 border border-theme-border rounded-lg">
          <p className="col-span-full text-sm text-theme-text-muted font-semibold">
            Scheda Tecnica (visibile nel preventivo WhatsApp)
          </p>
          <Input label="Anno Modello" type="number" value={form.model_year} onChange={(e) => setForm(prev => ({ ...prev, model_year: e.target.value }))} placeholder="2025" />
          <Input label="Cavalli (CV)" type="number" value={form.cv} onChange={(e) => setForm(prev => ({ ...prev, cv: e.target.value }))} placeholder="400" />
          <Input label="0-100 km/h (s)" type="number" step="0.1" value={form.acceleration_0_100} onChange={(e) => setForm(prev => ({ ...prev, acceleration_0_100: e.target.value }))} placeholder="3.8" />
        </div>
      )}

      {/* Dates */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 ${slotUnavailableWarning ? 'p-3 rounded-lg border-2 border-red-500/60 bg-red-500/5' : ''}`}>
        <Input label="Data Ritiro *" type="date" value={form.pickup_date} onChange={(e) => {
          const newPickup = e.target.value
          // Auto-advance return date to the day after pickup unless the
          // admin already configured a longer rental (return strictly
          // after the new pickup date).
          let nextReturn = ''
          if (newPickup) {
            const d = new Date(newPickup + 'T12:00:00')
            d.setDate(d.getDate() + 1)
            nextReturn = d.toISOString().split('T')[0]
          }
          setForm(prev => {
            const currentReturn = prev.return_date
            const keepCurrent = currentReturn && currentReturn > newPickup
            return {
              ...prev,
              pickup_date: newPickup,
              return_date: keepCurrent ? currentReturn : nextReturn,
            }
          })
        }} />
        <Select label="Ora Ritiro" value={form.pickup_time} onChange={(e) => {
          const newPickupTime = e.target.value
          const [h, m] = newPickupTime.split(':').map(Number)
          const d = new Date(); d.setHours(h, m, 0); d.setMinutes(d.getMinutes() - 90)
          const autoReturn = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          setForm(prev => ({ ...prev, pickup_time: newPickupTime, return_time: autoReturn }))
        }} options={buildTimeOptions(form.pickup_date, 'pickup')} />
        <Input label="Data Riconsegna *" type="date" value={form.return_date} onChange={(e) => setForm(prev => ({ ...prev, return_date: e.target.value }))} />
        <Select label="Ora Riconsegna (auto: ritiro -1h30)" value={form.return_time} onChange={(e) => {
          const v = e.target.value
          setForm(prev => ({ ...prev, return_time: v }))
        }} options={buildTimeOptions(form.return_date, 'return')} />
      </div>

      {slotUnavailableWarning && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <span className="text-red-400 text-lg leading-none">⚠</span>
          <div className="flex-1">
            <p className="text-sm text-red-300 font-medium">Slot non disponibile</p>
            <p className="text-xs text-red-300/80 mt-1">{slotUnavailableWarning}</p>
            {!slotOverrideId && (
              <p className="mt-2 text-xs text-red-300/80 italic">L'autorizzazione direzionale verrà richiesta al Salva.</p>
            )}
          </div>
        </div>
      )}

      {slotOverrideId && (
        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
          ✓ Autorizzazione concessa per questo slot — puoi procedere con il salvataggio.
        </div>
      )}

      {rentalDays > 0 && (
        <p className="text-sm text-theme-text-muted">
          Durata: <strong className="text-theme-text-primary">{rentalDays} giorn{rentalDays === 1 ? 'o' : 'i'}</strong>
        </p>
      )}

      {/* Pickup / Dropoff Locations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Select
            label="Luogo Ritiro"
            value={form.pickup_location}
            onChange={(e) => {
              const loc = LOCATIONS.find(l => l.value === e.target.value)
              setForm(prev => ({
                ...prev,
                pickup_location: e.target.value,
                delivery_fee: loc && e.target.value !== 'domicilio' ? String(loc.fee) : prev.delivery_fee,
                delivery_address: '',
              }))
            }}
            options={LOCATIONS.map(l => ({ value: l.value, label: l.label }))}
          />
          {form.pickup_location === 'domicilio' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input label="Indirizzo consegna" value={form.delivery_address} onChange={(e) => setForm(prev => ({ ...prev, delivery_address: e.target.value }))} placeholder="Via, citta, CAP" />
              <Input label="Costo consegna (€)" type="number" value={form.delivery_fee} onChange={(e) => setForm(prev => ({ ...prev, delivery_fee: e.target.value }))} placeholder="0" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Select
            label="Luogo Riconsegna"
            value={form.dropoff_location}
            onChange={(e) => {
              const loc = LOCATIONS.find(l => l.value === e.target.value)
              setForm(prev => ({
                ...prev,
                dropoff_location: e.target.value,
                pickup_fee: loc && e.target.value !== 'domicilio' ? String(loc.fee) : prev.pickup_fee,
                pickup_address: '',
              }))
            }}
            options={LOCATIONS.map(l => ({ value: l.value, label: l.label }))}
          />
          {form.dropoff_location === 'domicilio' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input label="Indirizzo ritiro" value={form.pickup_address} onChange={(e) => setForm(prev => ({ ...prev, pickup_address: e.target.value }))} placeholder="Via, citta, CAP" />
              <Input label="Costo ritiro (€)" type="number" value={form.pickup_fee} onChange={(e) => setForm(prev => ({ ...prev, pickup_fee: e.target.value }))} placeholder="0" />
            </div>
          )}
        </div>
      </div>

      {/* Revenue Pricing Info */}
      {revenueLoading && (
        <p className="text-sm text-theme-text-muted animate-pulse">Calcolo prezzo revenue management...</p>
      )}

      {/* Maggiorazione */}
      <Input
        label="Maggiorazione Preventivo (%)"
        type="number"
        step="0.1"
        value={form.maggiorazione_pct}
        onChange={(e) => setForm(prev => ({ ...prev, maggiorazione_pct: e.target.value }))}
        placeholder="0"
      />

      {/* Insurance */}
      {insuranceOptions.length > 0 && (
        <Select
          label="Assicurazione"
          value={form.insurance_option}
          onChange={(e) => setForm(prev => ({ ...prev, insurance_option: e.target.value }))}
          options={[
            { value: '', label: 'Nessuna assicurazione' },
            ...insuranceOptions.map(i => ({
              value: i.id,
              label: `${i.label} (${formatEur(i.pricePerDay)}/giorno)`
            }))
          ]}
        />
      )}

      {/* Extras Toggles */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-theme-text-primary">Extra</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-theme-border/50 hover:bg-theme-bg-tertiary/30">
            <input type="checkbox" checked={form.include_lavaggio} onChange={(e) => setForm(prev => ({ ...prev, include_lavaggio: e.target.checked }))} className="w-4 h-4 accent-dr7-gold" />
            <span className="text-sm text-theme-text-primary">Lavaggio ({formatEur(proLavaggioFee)})</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-theme-border/50 hover:bg-theme-bg-tertiary/30">
            <input type="checkbox" checked={form.include_no_cauzione} onChange={(e) => handleNoCauzioneToggle(e.target.checked)} className="w-4 h-4 accent-dr7-gold" />
            <span className="text-sm text-theme-text-primary">
              No Cauzione ({formatEur(noCauzioneResolvedDaily)}/giorno)
              {isFasciaB && !isValerio && (
                <span className="ml-2 text-xs text-amber-400">(Fascia B → richiede autorizzazione)</span>
              )}
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-theme-border/50 hover:bg-theme-bg-tertiary/30">
            <input type="checkbox" checked={form.include_cauzione_veicoli} onChange={(e) => setForm(prev => ({ ...prev, include_cauzione_veicoli: e.target.checked }))} className="w-4 h-4 accent-dr7-gold" />
            <span className="text-sm text-theme-text-primary">
              Cauzione Veicolo ({formatEur((configOverlay as any).cauzioneVeicoliPerDay ?? 20)}/giorno)
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-theme-border/50 hover:bg-theme-bg-tertiary/30">
            <input type="checkbox" checked={form.include_unlimited_km} onChange={(e) => setForm(prev => ({ ...prev, include_unlimited_km: e.target.checked }))} className="w-4 h-4 accent-dr7-gold" />
            <span className="text-sm text-theme-text-primary">
              Km Illimitati ({formatEur(proUnlimitedKmDaily)}/giorno)
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-theme-border/50 hover:bg-theme-bg-tertiary/30">
            <input type="checkbox" checked={form.include_second_driver} onChange={(e) => setForm(prev => ({ ...prev, include_second_driver: e.target.checked }))} className="w-4 h-4 accent-dr7-gold" />
            <span className="text-sm text-theme-text-primary">
              Secondo Guidatore ({formatEur(proSecondDriverDaily)}/giorno)
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-theme-border/50 hover:bg-theme-bg-tertiary/30">
            <input type="checkbox" checked={form.include_dr7_flex} onChange={(e) => setForm(prev => ({ ...prev, include_dr7_flex: e.target.checked }))} className="w-4 h-4 accent-dr7-gold" />
            <span className="text-sm text-theme-text-primary">
              DR7 FLEX — Cancellazione Premium ({formatEur(proDr7FlexDaily)}/giorno)
            </span>
          </label>
        </div>
      </div>

      {/* Experience Services */}
      {availableExperienceServices.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-theme-text-primary">Servizi Experience</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {availableExperienceServices.map(svc => {
              const qty = form.experience_services[svc.id] || 0
              const isQuantity = svc.unit === 'per_item' || svc.unit === 'per_hour'
              const isPerKm = svc.unit === 'per_km'

              // Per-km service: two free-text inputs (km + €/km), no qty stepper.
              if (isPerKm) {
                const quote = form.experience_km_quotes[svc.id] || { km: 0, pricePerKm: 0 }
                const isActive = quote.km > 0 && quote.pricePerKm > 0
                const total = Math.round(quote.km * quote.pricePerKm * 100) / 100
                return (
                  <div
                    key={svc.id}
                    className={`p-3 rounded-lg border transition-colors col-span-1 md:col-span-2 ${
                      isActive ? 'border-dr7-gold/50 bg-dr7-gold/5' : 'border-theme-border/50 hover:bg-theme-bg-tertiary/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2 gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-theme-text-primary">{svc.name}</span>
                        <span className="text-xs text-theme-text-muted ml-2">(prezzo al km manuale)</span>
                      </div>
                      {isActive && (
                        <span className="text-sm text-dr7-gold font-semibold whitespace-nowrap">
                          {quote.km} km × {formatEur(quote.pricePerKm)} = {formatEur(total)}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Input
                        label="Numero KM"
                        type="number"
                        step="1"
                        min="0"
                        value={quote.km > 0 ? String(quote.km) : ''}
                        onChange={(e) => {
                          const km = Math.max(0, Number(e.target.value) || 0)
                          setForm(prev => {
                            const next = { ...prev.experience_km_quotes }
                            if (km > 0) next[svc.id] = { ...(next[svc.id] || { pricePerKm: 0 }), km }
                            else delete next[svc.id]
                            return { ...prev, experience_km_quotes: next }
                          })
                        }}
                        placeholder="es. 200"
                      />
                      <Input
                        label="Prezzo per KM (€)"
                        type="number"
                        step="0.01"
                        min="0"
                        value={quote.pricePerKm > 0 ? String(quote.pricePerKm) : ''}
                        onChange={(e) => {
                          const pricePerKm = Math.max(0, Number(e.target.value) || 0)
                          setForm(prev => {
                            const next = { ...prev.experience_km_quotes }
                            if (pricePerKm > 0) next[svc.id] = { ...(next[svc.id] || { km: 0 }), pricePerKm }
                            else delete next[svc.id]
                            return { ...prev, experience_km_quotes: next }
                          })
                        }}
                        placeholder="es. 0.50"
                      />
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={svc.id}
                  className={`flex items-center justify-between gap-3 p-2 rounded-lg border transition-colors ${
                    qty > 0 ? 'border-dr7-gold/50 bg-dr7-gold/5' : 'border-theme-border/50 hover:bg-theme-bg-tertiary/30'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-theme-text-primary">{svc.name}</span>
                    <span className="text-xs text-theme-text-muted ml-2">
                      {formatEur(svc.price)}{UNIT_LABELS[svc.unit] || ''}
                    </span>
                  </div>
                  {isQuantity ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setForm(prev => {
                          const svcs = { ...prev.experience_services }
                          if (qty <= 1) delete svcs[svc.id]; else svcs[svc.id] = qty - 1
                          return { ...prev, experience_services: svcs }
                        })}
                        className="w-7 h-7 rounded bg-theme-bg-tertiary text-theme-text-primary text-sm hover:bg-theme-bg-hover"
                      >-</button>
                      <span className="w-6 text-center text-sm text-theme-text-primary">{qty}</span>
                      <button
                        onClick={() => setForm(prev => ({ ...prev, experience_services: { ...prev.experience_services, [svc.id]: qty + 1 } }))}
                        className="w-7 h-7 rounded bg-theme-bg-tertiary text-theme-text-primary text-sm hover:bg-theme-bg-hover"
                      >+</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setForm(prev => {
                        const svcs = { ...prev.experience_services }
                        if (qty > 0) delete svcs[svc.id]; else svcs[svc.id] = 1
                        return { ...prev, experience_services: svcs }
                      })}
                      className={`px-3 py-1 text-xs rounded ${qty > 0 ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'}`}
                    >
                      {qty > 0 ? 'Aggiunto' : 'Aggiungi'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pricing Summary */}
      <div className="p-4 bg-theme-bg-tertiary border border-theme-border rounded-lg space-y-2">
        <p className="font-bold text-theme-text-primary text-lg">Riepilogo Preventivo</p>

        <div className="flex justify-between text-sm text-theme-text-primary">
          <span>{rentalDays}gg x {formatEur(pricing.baseDailyRate)}/giorno</span>
          <span>{formatEur(Math.round(pricing.baseDailyRate * rentalDays * 100) / 100)}</span>
        </div>

        {pricing.insuranceTotal > 0 && (
          <div className="flex justify-between text-sm text-theme-text-muted">
            <span>Assicurazione ({insuranceOptions.find(i => i.id === form.insurance_option)?.label})</span>
            <span>{formatEur(pricing.insuranceTotal)}</span>
          </div>
        )}
        {pricing.lavaggioFee > 0 && (
          <div className="flex justify-between text-sm text-theme-text-muted">
            <span>Lavaggio</span>
            <span>{formatEur(pricing.lavaggioFee)}</span>
          </div>
        )}
        {pricing.noCauzioneTotal > 0 && (
          <div className="flex justify-between text-sm text-theme-text-muted">
            <span>No Cauzione ({rentalDays}gg x {formatEur(pricing.noCauzioneDaily)})</span>
            <span>{formatEur(pricing.noCauzioneTotal)}</span>
          </div>
        )}
        {pricing.unlimitedKmTotal > 0 && (
          <div className="flex justify-between text-sm text-theme-text-muted">
            <span>Km Illimitati ({rentalDays}gg x {formatEur(pricing.unlimitedKmDaily)})</span>
            <span>{formatEur(pricing.unlimitedKmTotal)}</span>
          </div>
        )}
        {pricing.secondDriverTotal > 0 && (
          <div className="flex justify-between text-sm text-theme-text-muted">
            <span>Secondo Guidatore ({rentalDays}gg x {formatEur(pricing.secondDriverDaily)})</span>
            <span>{formatEur(pricing.secondDriverTotal)}</span>
          </div>
        )}
        {pricing.dr7FlexTotal > 0 && (
          <div className="flex justify-between text-sm text-theme-text-muted">
            <span>DR7 FLEX ({rentalDays}gg x {formatEur(pricing.dr7FlexDaily)})</span>
            <span>{formatEur(pricing.dr7FlexTotal)}</span>
          </div>
        )}
        {pricing.cauzioneVeicoliTotal > 0 && (
          <div className="flex justify-between text-sm text-theme-text-muted">
            <span>Cauzione Veicolo ({rentalDays}gg x {formatEur(pricing.cauzioneVeicoliDaily)})</span>
            <span>{formatEur(pricing.cauzioneVeicoliTotal)}</span>
          </div>
        )}
        {pricing.deliveryFee > 0 && (
          <div className="flex justify-between text-sm text-theme-text-muted">
            <span>Consegna ({LOCATIONS.find(l => l.value === form.pickup_location)?.label || 'Domicilio'})</span>
            <span>{formatEur(pricing.deliveryFee)}</span>
          </div>
        )}
        {pricing.pickupFee > 0 && (
          <div className="flex justify-between text-sm text-theme-text-muted">
            <span>Ritiro ({LOCATIONS.find(l => l.value === form.dropoff_location)?.label || 'Domicilio'})</span>
            <span>{formatEur(pricing.pickupFee)}</span>
          </div>
        )}
        {pricing.experienceCost > 0 && (
          <div className="flex justify-between text-sm text-theme-text-muted">
            <span>Servizi Experience</span>
            <span>{formatEur(pricing.experienceCost)}</span>
          </div>
        )}

        {/* Revenue coefficients applied to total. Lo sconto mostrato qui
            è calcolato sul subtotale "no experience / no location fees"
            perché il coefficiente NON viene applicato a consegna/ritiro
            né ai Servizi Experience — passano a listino. Mostrare la
            differenza sull'intero listino sarebbe fuorviante: l'admin
            vedrebbe uno sconto più grande di quello effettivamente
            applicato al Subtotale qui sotto. */}
        {pricing.revenueBreakdown.length > 0 && pricing.revenueCoeff !== 1 && (
          <>
            <div className="border-t border-theme-border pt-2 flex justify-between text-sm text-theme-text-muted">
              <span>Subtotale Listino</span>
              <span>{formatEur(pricing.listSubtotal)}</span>
            </div>
            {pricing.revenueBreakdown.map((b, i) => (
              <div key={i} className="flex justify-between text-xs text-theme-text-muted pl-2">
                <span>{b.label}: x{b.coeff.toFixed(2)} ({b.description})</span>
              </div>
            ))}
            <div className="flex justify-between text-xs text-dr7-gold pl-2">
              <span>Coefficiente combinato: x{pricing.revenueCoeff.toFixed(4)} (escl. consegna/ritiro/experience)</span>
              <span>{pricing.revenueCoeff < 1 ? `-${formatEur(pricing.listSubtotalNoExp - pricing.listSubtotalNoExp * pricing.revenueCoeff)}` : `+${formatEur(pricing.listSubtotalNoExp * pricing.revenueCoeff - pricing.listSubtotalNoExp)}`}</span>
            </div>
          </>
        )}

        <div className="border-t border-theme-border pt-2 flex justify-between text-theme-text-primary font-semibold">
          <span>Subtotale</span>
          <span>{formatEur(pricing.subtotalDisplay)}</span>
        </div>

        {/* Min/Max clamp indicator — shown only when the uncapped subtotal was
            clipped by the per-vehicle daily limits (Prezzi Base in Centralina). */}
        {pricing.clampHit && (
          <>
            <div className="flex justify-between text-sm text-yellow-500 font-medium">
              <span>
                ⚠️ Limite {pricing.clampHit === 'max' ? 'Max' : 'Min'} Raggiunto
                {pricing.clampLimitDaily != null && (
                  <span className="text-theme-text-muted font-normal"> ({formatEur(pricing.clampLimitDaily)}/g × {rentalDays}gg, escl. experience)</span>
                )}
              </span>
            </div>
            <div className="flex justify-between text-theme-text-primary font-semibold">
              <span>Nuovo totale</span>
              <span>{formatEur(pricing.afterRevenue)}</span>
            </div>
          </>
        )}

        {pricing.maggiorazione > 0 && (
          <div className="flex justify-between text-sm text-dr7-gold">
            <span>Maggiorazione preventivo (+{pricing.maggiorazione}%)</span>
            <span>+{formatEur(pricing.maggiorazioneAmount)}</span>
          </div>
        )}

        {/* Sconto */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <Input label="Prezzo Finale Desiderato (€)" type="number" step="0.01" value={form.sconto} onChange={(e) => setForm(prev => ({ ...prev, sconto: e.target.value }))} placeholder="Lascia vuoto per nessuno sconto" />
          <Input label="Nota sconto" value={form.sconto_note} onChange={(e) => setForm(prev => ({ ...prev, sconto_note: e.target.value }))} placeholder="valido solo 24h" />
        </div>

        {pricing.sconto > 0 && (
          <div className="flex justify-between text-sm text-red-400">
            <span>Sconto {form.sconto_note && `(${form.sconto_note})`}</span>
            <span>-{formatEur(pricing.sconto)}</span>
          </div>
        )}

        {/* KM inclusi */}
        <div className="flex justify-between text-sm text-theme-text-muted">
          <span>KM Inclusi</span>
          <span>{pricing.kmIncluded === 'unlimited' ? 'Illimitati' : `${pricing.kmIncluded} Km`}</span>
        </div>
        <div className="flex justify-between text-sm text-theme-text-muted">
          <span>Sforo KM</span>
          <span>{formatEur(pricing.sforo)}/km</span>
        </div>

        <div className="border-t border-dr7-gold/50 pt-2 flex justify-between text-xl font-bold text-dr7-gold">
          <span>TOTALE FINALE</span>
          <span>{formatEur(pricing.totalFinal)}</span>
        </div>
      </div>

      {/* Actions — inline, responsive. Mobile (< 640px): stacked full-width,
          primary on top. Desktop (≥ 640px): right-aligned row, Annulla left.
          Both new and edit flows offer a "save + send via WhatsApp" CTA when
          a customer with a phone is selected. */}
      <div className="flex flex-col sm:flex-row sm:gap-3 sm:justify-end gap-2 pt-2">
        <Button
          disabled={
            saving ||
            sendingWhatsapp ||
            !form.vehicle_id ||
            rentalDays < 1 ||
            !selectedCustomerId ||
            !customers.find((c: any) => c.id === selectedCustomerId)?.phone
          }
          onClick={() => handleSave(true)}
          className="w-full sm:w-auto order-1"
          title={
            !selectedCustomerId
              ? 'Seleziona un cliente sopra (campo Fascia)'
              : !customers.find((c: any) => c.id === selectedCustomerId)?.phone
                ? 'Il cliente selezionato non ha un numero di telefono'
                : ''
          }
        >
          {saving || sendingWhatsapp ? 'Invio...' : (editingId ? 'Aggiorna e invia' : 'Salva e invia')}
        </Button>
        <Button
          disabled={saving || !form.vehicle_id || rentalDays < 1}
          onClick={() => handleSave(false)}
          className="w-full sm:w-auto order-2"
        >
          {saving ? 'Salvataggio...' : (editingId ? 'Aggiorna Preventivo' : 'Salva Preventivo')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => { setView('list'); setEditingId(null); resetForm() }}
          className="w-full sm:w-auto order-3 sm:-order-1"
        >
          Annulla
        </Button>
      </div>

      {/* OTP combinata — opened ONLY at Salva. Se più gate scattano insieme
          (Fuori orario + No Cauzione + Slot) la modal mostra TUTTE le
          motivazioni e la direzione riceve UNA sola email con l'elenco
          completo. La limitationCode dell'email rispecchia il primo gate
          scattato (per coerenza con il log) ma il messaggio combina tutti
          i motivi. All'approvazione marchiamo come autorizzati TUTTI i
          gate tripped con lo stesso overrideId, così il resume non chiede
          una seconda OTP. */}
      <LimitationOverrideModal
        isOpen={combinedOtpOpen}
        limitationCode={(() => {
          // Codici canonici allineati a system_otp_overrides — così
          // disattivando una riga in Gestione OTP la modal/log mostrano
          // lo stesso identificativo.
          if (combinedOtpTripped.includes('out_of_hours')) return 'out_of_office_hours'
          if (combinedOtpTripped.includes('no_cauzione')) return 'tier1_no_cauzione'
          if (combinedOtpTripped.includes('slot')) return 'slot_unavailable'
          return 'preventivo_save'
        })()}
        limitationMessage={
          combinedOtpMotivazioni.length === 0
            ? 'Autorizzazione richiesta'
            : combinedOtpMotivazioni.length === 1
              ? combinedOtpMotivazioni[0]
              : `${combinedOtpMotivazioni.length} condizioni richiedono autorizzazione`
        }
        details={otpDetails}
        showNotes
        draftSessionId={draftSessionIdRef.current}
        flowType="preventivo"
        onCancel={() => {
          // X = back to the form, save NOT performed. Form values stay intact.
          setCombinedOtpOpen(false)
          setCombinedOtpMotivazioni([])
          setCombinedOtpTripped([])
          pendingSaveRef.current = null
        }}
        onOverrideApproved={(overrideId) => {
          // Marchiamo come approvati tutti i gate scattati con lo stesso
          // overrideId. Il resume effect riprende handleSave e tutti e tre
          // i gate vedono il proprio override id valorizzato.
          if (combinedOtpTripped.includes('out_of_hours')) setOutOfHoursOverrideId(overrideId)
          if (combinedOtpTripped.includes('no_cauzione')) setNoCauzioneOverrideId(overrideId)
          if (combinedOtpTripped.includes('slot')) {
            setSlotOverrideId(overrideId)
            setSlotUnavailableWarning('')
          }
          setCombinedOtpOpen(false)
          setCombinedOtpMotivazioni([])
          setCombinedOtpTripped([])
        }}
      />

      {/* Modal motivo rifiuto — listens to window CustomEvent, owns its own
          state, renders via portal at document.body. Click "Rifiutato" sulle
          righe non causa re-render della lista. */}
      <PreventivoRejectModal onConfirm={confirmReject} />
      <PreventivoAcceptModal onConfirm={confirmAccept} customers={customers} />
    </div>
  )
}
