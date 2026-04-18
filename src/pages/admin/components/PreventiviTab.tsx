import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { appendPreventivoEvent } from '../../../utils/preventivoEvents'
import { useRentalConfig } from '../../../hooks/useRentalConfig'
import { buildConfigOverlay } from '../../../utils/configOverlay'
import { getKmIncluded, getInsuranceOptions, getUnlimitedKmPrice } from '../../../utils/configLookup'
import type { RentalConfig } from '../../../types/rentalConfig'
import Input from './Input'
import Select from './Select'
import Button from './Button'
import CustomerAutocomplete from './CustomerAutocomplete'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { classifyDriverTier, calculateAge, calculateLicenseYears } from '../../../utils/tierClassification'

// ─── Time slots (office hours, 30-min intervals) ────────────────────────────
function genSlots(ranges: [number, number][]): { value: string; label: string }[] {
  const s: { value: string; label: string }[] = []
  for (const [a, b] of ranges) {
    for (let m = a; m <= b; m += 30) {
      const t = `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`
      s.push({ value: t, label: t })
    }
  }
  return s
}
const PICKUP_SLOTS = genSlots([[10*60+30, 12*60+30], [15*60+30, 18*60+30]])
const RETURN_SLOTS = genSlots([[9*60, 12*60+30], [14*60, 17*60+30]])

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

function calculateExperienceCost(services: Record<string, number>, rentalDays: number, allServices: { id: string; name: string; price: number; unit: string }[]): number {
  let total = 0
  for (const [id, qty] of Object.entries(services)) {
    if (qty <= 0) continue
    const svc = allServices.find(s => s.id === id)
    if (!svc) continue
    if (svc.unit === 'per_day') total += svc.price * rentalDays * qty
    else if (svc.unit === 'per_hour') total += svc.price * qty
    else if (svc.unit === 'per_item') total += svc.price * qty
    else if (svc.unit === 'flat') total += svc.price * qty
  }
  return Math.round(total * 100) / 100
}

const UNIT_LABELS: Record<string, string> = {
  per_day: '/giorno',
  per_hour: '/ora',
  per_item: '/unita',
  flat: 'fisso',
}

const LOCATIONS = [
  { value: 'dr7_office', label: 'DR7 — Viale Marconi 229, Cagliari', fee: 0 },
  { value: 'cagliari_airport', label: 'Aeroporto Cagliari Elmas', fee: 50 },
  { value: 'alghero_airport', label: 'Aeroporto Alghero', fee: 50 },
  { value: 'domicilio', label: 'Domicilio (indirizzo custom)', fee: 0 },
]

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

const VALERIO_EMAIL = 'valerio@dr7.app'
const BOSS_PHONE = '393472817258'

export default function PreventiviTab({ onConvertToBooking }: Props) {
  const { adminEmail } = useAdminRole()
  const isValerio = adminEmail?.toLowerCase() === VALERIO_EMAIL
  const [view, setView] = useState<'list' | 'form'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [preventivi, setPreventivi] = useState<Preventivo[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false)
  const [selectedPreventivo, setSelectedPreventivo] = useState<Preventivo | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
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

  // Centralina config
  const { config: rentalConfig } = useRentalConfig()
  const configOverlay = useMemo(() => buildConfigOverlay(rentalConfig), [rentalConfig])

  // ─── Form State ─────────────────────────────────────────────────────────

  const [form, setForm] = useState({
    vehicle_id: '',
    pickup_date: '',
    pickup_time: '10:30',
    return_date: '',
    return_time: '10:00',
    driver_tier: 'TIER_2' as DriverTier,
    maggiorazione_pct: String(configOverlay.maggiorazionePct),
    insurance_option: '',
    // Extras
    include_lavaggio: true,
    include_no_cauzione: false,
    include_unlimited_km: false,
    include_second_driver: false,
    include_dr7_flex: false,
    // Delivery / Pickup
    pickup_location: 'dr7_office',
    dropoff_location: 'dr7_office',
    delivery_fee: '0',
    pickup_fee: '0',
    delivery_address: '',
    pickup_address: '',
    // Experience services: id → quantity
    experience_services: {} as Record<string, number>,
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

  // Revenue pricing
  const [revenueData, setRevenueData] = useState<{
    finalDailyRateEur: number
    finalTotalEur: number
    rentalDays: number
    breakdown: { label: string; coeff: number; description: string }[]
    mode: string
    enabled: boolean
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
    // Always use vehicle list price (not dynamic Revenue price)
    const listDailyRate = selectedVehicle ? selectedVehicle.daily_rate : 0
    const maggiorazione = parseFloat(form.maggiorazione_pct) || 0

    // Base prices at list rate
    const listRentalTotal = Math.round(listDailyRate * rentalDays * 100) / 100

    const selectedIns = insuranceOptions.find(i => i.id === form.insurance_option)
    const insuranceDailyPrice = selectedIns?.pricePerDay ?? 0
    const insuranceTotal = Math.round(insuranceDailyPrice * rentalDays * 100) / 100

    const lavaggioFee = form.include_lavaggio ? configOverlay.lavaggioFee : 0

    const noCauzioneDaily = form.include_no_cauzione ? configOverlay.noCauzionePerDay : 0
    const noCauzioneTotal = Math.round(noCauzioneDaily * rentalDays * 100) / 100

    const unlimitedKmDaily = form.include_unlimited_km
      ? getUnlimitedKmPriceForVehicle(selectedVehicle, form.driver_tier, rentalConfig, configOverlay)
      : 0
    const unlimitedKmTotal = Math.round(unlimitedKmDaily * rentalDays * 100) / 100

    const secondDriverDaily = form.include_second_driver
      ? (form.driver_tier === 'TIER_2' ? configOverlay.secondDriverTier2 : configOverlay.secondDriverTier1)
      : 0
    const secondDriverTotal = Math.round(secondDriverDaily * rentalDays * 100) / 100

    const dr7FlexDaily = form.include_dr7_flex ? configOverlay.dr7FlexPerDay : 0
    const dr7FlexTotal = Math.round(dr7FlexDaily * rentalDays * 100) / 100

    const deliveryFee = parseFloat(form.delivery_fee) || 0
    const pickupFee = parseFloat(form.pickup_fee) || 0

    const experienceCost = calculateExperienceCost(form.experience_services, rentalDays, configOverlay.experienceServices)

    // List subtotal (before revenue coefficients and maggiorazione)
    const listSubtotal = listRentalTotal + insuranceTotal + lavaggioFee + noCauzioneTotal + unlimitedKmTotal + secondDriverTotal + dr7FlexTotal + deliveryFee + pickupFee + experienceCost

    // Apply revenue coefficients to the TOTAL
    const revenueCoeff = revenueData?.enabled
      ? (revenueData.breakdown || []).reduce((acc, b) => acc * b.coeff, 1)
      : 1
    const afterRevenue = Math.round(listSubtotal * revenueCoeff * 100) / 100

    // Apply maggiorazione on top
    const markupMultiplier = 1 + maggiorazione / 100
    const subtotal = Math.round(afterRevenue * markupMultiplier * 100) / 100

    // Daily rate at list price (for display in riepilogo first line)
    const dailyAfterCoeff = Math.round(listDailyRate * revenueCoeff * markupMultiplier * 100) / 100
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
      deliveryFee,
      pickupFee,
      experienceCost,
      listSubtotal,
      revenueCoeff,
      revenueBreakdown: revenueData?.breakdown || [],
      afterRevenue,
      maggiorazioneAmount,
      subtotal,
      sconto,
      totalFinal,
      kmIncluded: rentalConfig ? getKmIncluded(rentalConfig, rentalDays, selectedVehicle?.category || 'exotic') : 0,
      sforo: (configOverlay as any).sforoKm ?? (configOverlay as any).sforo_km ?? 1.80,
    }
  }, [form, rentalDays, revenueData, selectedVehicle, insuranceOptions, configOverlay, rentalConfig])

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
        await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: custPhone,
            customMessage: `Gentile ${custName.split(' ')[0]},\n\nla sua richiesta per la formula senza cauzione è stata approvata!\n\nPer completare la prenotazione #${bookingRef}, effettui il pagamento di €${totalEur.toFixed(2)} tramite il seguente link:\n${linkData.paymentUrl}\n\n⏳ Il link è valido per 24 ore.\n\nCordiali Saluti,\nDR7`,
          })
        })
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

      if (custPhone) {
        await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: custPhone,
            customMessage: `Gentile ${custName.split(' ')[0]},\n\nla formula senza cauzione non risulta disponibile per questa prenotazione.\n\nPuò comunque procedere subito con la conferma tramite formula standard:\nil preventivo è già nel suo account.\n\nAbbiamo attivato per lei uno sconto del 5% con codice:\n${code}\n\nDisponibilità limitata.\n\nCordiali Saluti,\nDR7`,
          })
        })
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
          include_lavaggio: form.include_lavaggio,
          include_no_cauzione: form.include_no_cauzione,
          include_unlimited_km: form.include_unlimited_km,
          include_second_driver: form.include_second_driver,
          include_dr7_flex: form.include_dr7_flex,
          dr7_flex_daily: pricing.dr7FlexDaily,
          dr7_flex_total: pricing.dr7FlexTotal,
          delivery_fee: pricing.deliveryFee,
          pickup_fee: pricing.pickupFee,
          pickup_location: form.pickup_location,
          dropoff_location: form.dropoff_location,
          delivery_address: form.delivery_address,
          pickup_address: form.pickup_address,
          experience_services: form.experience_services,
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
      if (editingId) {
        setPreventivi(prev => prev.map(p => p.id === editingId ? data : p))
      } else {
        setPreventivi(prev => [data, ...prev])
      }
      const wasEditing = !!editingId
      setView('list')
      setEditingId(null)
      resetForm()

      if (sendAfterSave && !wasEditing && data) {
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
      maggiorazione_pct: String(p.maggiorazione_pct || 0),
      insurance_option: p.insurance_option || '',
      include_lavaggio: !!extras.include_lavaggio || p.lavaggio_fee > 0,
      include_no_cauzione: !!extras.include_no_cauzione || p.no_cauzione_total > 0,
      include_unlimited_km: !!extras.include_unlimited_km || p.unlimited_km_total > 0,
      include_second_driver: !!extras.include_second_driver || p.second_driver_total > 0,
      include_dr7_flex: !!extras.include_dr7_flex,
      pickup_location: extras.pickup_location || 'dr7_office',
      dropoff_location: extras.dropoff_location || 'dr7_office',
      delivery_fee: String(extras.delivery_fee || 0),
      pickup_fee: String(extras.pickup_fee || 0),
      delivery_address: extras.delivery_address || '',
      pickup_address: extras.pickup_address || '',
      experience_services: extras.experience_services || {},
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
      return_time: '10:00',
      driver_tier: 'TIER_2',
      maggiorazione_pct: String(configOverlay.maggiorazionePct),
      insurance_option: '',
      include_lavaggio: true,
      include_no_cauzione: false,
      include_unlimited_km: false,
      include_second_driver: false,
      include_dr7_flex: false,
      pickup_location: 'dr7_office',
      dropoff_location: 'dr7_office',
      delivery_fee: '0',
      pickup_fee: '0',
      delivery_address: '',
      pickup_address: '',
      experience_services: {},
      sconto: '',
      sconto_note: 'valido solo 24h',
      model_year: '',
      cv: '',
      acceleration_0_100: '',
    })
    setRevenueData(null)
  }

  // ─── WhatsApp Send ──────────────────────────────────────────────────────

  function buildDefaultPreventivoMessage(p: Preventivo): string {
    const specs = [
      p.vehicle_name,
      p.vehicle_model_year ? `my ${p.vehicle_model_year}` : '',
      p.vehicle_cv ? `${p.vehicle_cv}cv` : '',
      p.vehicle_0_100 ? `0-100 ${String(p.vehicle_0_100).replace('.', ',')}s` : '',
    ].filter(Boolean).join(' ')

    let msg = `Preventivo ${specs}\n\n`
    msg += `${p.rental_days}gg x ${formatEur(p.base_daily_rate)}/g = ${formatEur(p.base_daily_rate * p.rental_days)}\n`

    if (p.insurance_total > 0) {
      const insLabel = insuranceOptions.find(i => i.id === p.insurance_option)?.label || p.insurance_option || 'Kasko'
      msg += `${insLabel} = ${formatEur(p.insurance_total)}\n`
    }

    if (p.lavaggio_fee > 0) msg += `Lavaggio = ${formatEur(p.lavaggio_fee)}\n`
    if (p.no_cauzione_total > 0) msg += `No cauzione = ${formatEur(p.no_cauzione_total)}\n`
    if (p.unlimited_km_total > 0) {
      msg += `Km illimitati = ${formatEur(p.unlimited_km_total)}\n`
    } else if (rentalConfig) {
      const kmInc = getKmIncluded(rentalConfig, p.rental_days, p.vehicle_category || 'exotic')
      msg += `Km inclusi: ${kmInc === 'unlimited' ? 'Illimitati' : `${kmInc} Km`}\n`
    }
    if (p.second_driver_total > 0) msg += `Secondo guidatore = ${formatEur(p.second_driver_total)}\n`

    const extras = p.extras_detail as Record<string, unknown> | null
    if (extras?.dr7_flex_total && Number(extras.dr7_flex_total) > 0) msg += `DR7 Flex = ${formatEur(Number(extras.dr7_flex_total))}\n`
    if (extras?.delivery_fee && Number(extras.delivery_fee) > 0) msg += `Consegna = ${formatEur(Number(extras.delivery_fee))}\n`
    if (extras?.pickup_fee && Number(extras.pickup_fee) > 0) msg += `Ritiro = ${formatEur(Number(extras.pickup_fee))}\n`
    if (extras?.experience_cost && Number(extras.experience_cost) > 0) msg += `Servizi experience = ${formatEur(Number(extras.experience_cost))}\n`

    msg += `\nTotale = ${formatEur(p.subtotal)}\n`

    if (p.sconto > 0) {
      msg += `sconto ${p.sconto_note || ''} ${formatEur(p.total_final)}`
    }

    const footer = rentalConfig?.preventivi?.whatsapp_footer
    if (footer) msg += `\n\n${footer}`

    return msg.trim()
  }

  async function formatWhatsAppMessage(p: Preventivo): Promise<string> {
    // Pick template based on whether a discount was applied
    const templateKey = p.sconto > 0 ? 'preventivo_whatsapp' : 'preventivo_whatsapp_no_sconto'

    // Try to load template from system_messages (with fallback to the default key)
    try {
      let { data: tpl } = await supabase
        .from('system_messages')
        .select('message_body, is_enabled')
        .eq('message_key', templateKey)
        .maybeSingle()

      // If the no-sconto variant doesn't exist or is disabled, fall back to the main template
      if ((!tpl || !tpl.is_enabled || !tpl.message_body) && templateKey !== 'preventivo_whatsapp') {
        const fallback = await supabase
          .from('system_messages')
          .select('message_body, is_enabled')
          .eq('message_key', 'preventivo_whatsapp')
          .maybeSingle()
        tpl = fallback.data
      }

      if (tpl?.is_enabled && tpl.message_body) {
        // Build variables for substitution
        const specs = [
          p.vehicle_name,
          p.vehicle_model_year ? `my ${p.vehicle_model_year}` : '',
          p.vehicle_cv ? `${p.vehicle_cv}cv` : '',
          p.vehicle_0_100 ? `0-100 ${String(p.vehicle_0_100).replace('.', ',')}s` : '',
        ].filter(Boolean).join(' ')

        // Build pricing lines
        let pricingLines = `${p.rental_days}gg x ${formatEur(p.base_daily_rate)}/g = ${formatEur((p.base_daily_rate) * p.rental_days)}`
        if (p.insurance_total > 0) {
          const insLabel = insuranceOptions.find(i => i.id === p.insurance_option)?.label || p.insurance_option || 'Kasko'
          pricingLines += `\n${insLabel} = ${formatEur(p.insurance_total)}`
        }
        if (p.lavaggio_fee > 0) pricingLines += `\nLavaggio = ${formatEur(p.lavaggio_fee)}`
        if (p.no_cauzione_total > 0) pricingLines += `\nNo cauzione = ${formatEur(p.no_cauzione_total)}`
        if (p.unlimited_km_total > 0) {
          pricingLines += `\nKm illimitati = ${formatEur(p.unlimited_km_total)}`
        } else if (rentalConfig) {
          const kmInc = getKmIncluded(rentalConfig, p.rental_days, p.vehicle_category || 'exotic')
          pricingLines += `\nKm inclusi: ${kmInc === 'unlimited' ? 'Illimitati' : `${kmInc} Km`}`
        }
        if (p.second_driver_total > 0) pricingLines += `\nSecondo guidatore = ${formatEur(p.second_driver_total)}`
        const extras = p.extras_detail as Record<string, unknown> | null
        if (extras?.dr7_flex_total && Number(extras.dr7_flex_total) > 0) pricingLines += `\nDR7 Flex = ${formatEur(Number(extras.dr7_flex_total))}`
        if (extras?.delivery_fee && Number(extras.delivery_fee) > 0) pricingLines += `\nConsegna = ${formatEur(Number(extras.delivery_fee))}`
        if (extras?.pickup_fee && Number(extras.pickup_fee) > 0) pricingLines += `\nRitiro = ${formatEur(Number(extras.pickup_fee))}`
        if (extras?.experience_cost && Number(extras.experience_cost) > 0) pricingLines += `\nServizi experience = ${formatEur(Number(extras.experience_cost))}`

        let discountLine = ''
        if (p.sconto > 0) discountLine = `sconto ${p.sconto_note || ''} ${formatEur(p.total_final)}`

        const vars: Record<string, string> = {
          vehicle_specs: specs,
          vehicle_name: p.vehicle_name || '',
          rental_days: String(p.rental_days),
          daily_rate: formatEur(p.base_daily_rate),
          rental_total: formatEur((p.base_daily_rate) * p.rental_days),
          insurance_line: p.insurance_total > 0 ? `${insuranceOptions.find(i => i.id === p.insurance_option)?.label || 'Kasko'} = ${formatEur(p.insurance_total)}` : '',
          pricing_lines: pricingLines,
          subtotal: formatEur(p.subtotal),
          total: formatEur(p.total_final || p.subtotal),
          sconto: discountLine,
          customer_name: p.customer_name || '',
          km_info: p.unlimited_km_total > 0 ? 'Illimitati' : (() => {
            if (!rentalConfig) return ''
            const km = getKmIncluded(rentalConfig, p.rental_days, p.vehicle_category || 'exotic')
            return km === 'unlimited' ? 'Illimitati' : `${km} Km`
          })(),
        }

        let msg = tpl.message_body
        for (const [k, v] of Object.entries(vars)) {
          msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v || '')
        }
        // Clean up empty lines from unused variables
        msg = msg.replace(/\n{3,}/g, '\n\n').trim()

        const footer = rentalConfig?.preventivi?.whatsapp_footer
        if (footer) msg += `\n\n${footer}`

        return msg
      }
    } catch {
      // Fallback to hardcoded
    }

    return buildDefaultPreventivoMessage(p)
  }

  async function handleSendWhatsApp(preventivo: Preventivo, phone: string) {
    setSendingWhatsapp(true)
    try {
      const message = await formatWhatsAppMessage(preventivo)

      const response = await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPhone: phone, customMessage: message, skipHeader: true })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Errore invio WhatsApp')

      const expiryHours = configOverlay.defaultExpiryHours || 24
      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString()

      const selectedCust = customers.find((c: any) => c.id === selectedCustomerId)
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
      toast.success('Preventivo inviato via WhatsApp!')
      setShowPhoneModal(false)
      setWhatsappPhone('')
      setSelectedCustomerId('')
      loadPreventivi()
    } catch (error: unknown) {
      console.error('WhatsApp send error:', error)
      toast.error('Errore invio WhatsApp')
    } finally {
      setSendingWhatsapp(false)
    }
  }

  // ─── Convert to Booking ─────────────────────────────────────────────────

  async function handleConvertToBooking(preventivo: Preventivo) {
    // No-cauzione requests require Valerio's approval
    const isNoCauzione = preventivo.source === 'website_no_cauzione'
    if (isNoCauzione && !isValerio) {
      // Send approval request to Valerio via WhatsApp
      const msg = `*RICHIESTA APPROVAZIONE NO CAUZIONE*\n\n`
        + `*Admin:* ${adminEmail}\n`
        + `*Cliente:* ${preventivo.customer_name || 'N/A'}\n`
        + `*Telefono:* ${preventivo.customer_phone || 'N/A'}\n`
        + `*Veicolo:* ${preventivo.vehicle_name}\n`
        + `*Totale:* €${(preventivo.total_final || 0).toFixed(2)}\n\n`
        + `Approva o rifiuta dal pannello admin > Preventivi.`

      fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPhone: BOSS_PHONE, customMessage: msg }),
      }).catch(() => {})

      toast.success('Richiesta approvazione inviata a Valerio')
      return
    }

    await supabase
      .from('preventivi')
      .update({ status: 'accettato' })
      .eq('id', preventivo.id)

    if (onConvertToBooking) {
      onConvertToBooking({
        vehicleId: preventivo.vehicle_id,
        pickupDate: new Date(preventivo.pickup_date),
        fromPreventivo: {
          preventivoId: preventivo.id,
          vehicle_id: preventivo.vehicle_id,
          pickup_date: preventivo.pickup_date,
          dropoff_date: preventivo.dropoff_date,
          insurance_option: preventivo.insurance_option,
          total_amount: preventivo.total_final,
          driver_tier: preventivo.driver_tier,
          unlimited_km: preventivo.unlimited_km_total > 0,
          no_cauzione: preventivo.no_cauzione_total > 0,
          include_lavaggio: preventivo.lavaggio_fee > 0,
          customer_phone: preventivo.customer_phone,
          customer_name: preventivo.customer_name,
        },
      })
    }
    toast.success('Preventivo accettato - compila la prenotazione')
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
      const msg = `Gentile ${firstName},\n\n`
        + `la formula senza cauzione non risulta disponibile per questa prenotazione.\n\n`
        + `Può comunque procedere subito con la conferma tramite formula standard:\n`
        + `il preventivo è già nel suo account.\n\n`
        + `Abbiamo attivato per lei uno sconto del 5% con codice:\n`
        + `${code}\n\n`
        + `Disponibilità limitata.`

      fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPhone: preventivo.customer_phone, customMessage: msg }),
      }).catch(() => {})
    }

    appendPreventivoEvent(preventivo.id, 'no_cauzione_rifiutato', { detail: `discount_code: ${code}` })
    toast.success(`Rifiutato — codice sconto ${code} inviato al cliente`)
    loadPreventivi()
  }

  async function updateStatus(id: string, newStatus: string) {
    await supabase.from('preventivi').update({ status: newStatus }).eq('id', id)
    loadPreventivi()
    toast.success(`Stato aggiornato: ${STATUS_LABELS[newStatus]}`)
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
          <div className="overflow-x-auto">
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
                      {p.customer_name && <div className="text-xs text-theme-text-muted">{p.customer_name} {p.customer_phone ? `· ${p.customer_phone}` : ''}</div>}
                      {!p.customer_name && p.customer_phone && <div className="text-xs text-theme-text-muted">{p.customer_phone}</div>}
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
                      <div className="mt-1 text-[11px] text-theme-text-muted whitespace-pre-wrap font-mono leading-relaxed bg-theme-bg-tertiary/50 rounded p-2 max-w-xs">
                        {buildDefaultPreventivoMessage(p)}
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
                        {p.source?.startsWith('website') && (p.status === 'bozza' || p.status === 'inviato') ? (
                          <>
                            <button
                              onClick={() => handleConvertToBooking(p)}
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
                                onClick={() => updateStatus(p.id, 'rifiutato')}
                                className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded"
                              >
                                Rifiuta
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            {(p.status === 'bozza' || p.status === 'inviato') && (
                              <button
                                onClick={() => handleEdit(p)}
                                className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded"
                              >
                                Modifica
                              </button>
                            )}
                            {(p.status === 'bozza' || p.status === 'inviato') && (
                              <button
                                onClick={() => { setSelectedPreventivo(p); setWhatsappPhone(p.customer_phone || ''); setShowPhoneModal(true) }}
                                className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded"
                              >
                                Invia
                              </button>
                            )}
                            {(p.status === 'inviato' || p.status === 'bozza') && (
                              <button
                                onClick={() => handleConvertToBooking(p)}
                                className="px-2 py-1 text-xs bg-dr7-gold hover:bg-[#247a6f] text-white rounded"
                              >
                                Converti
                              </button>
                            )}
                            {p.status === 'inviato' && (
                              <button
                                onClick={() => updateStatus(p.id, 'rifiutato')}
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
        </>}

        {/* Phone Modal */}
        {showPhoneModal && selectedPreventivo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-theme-bg-secondary rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
              <h3 className="text-lg font-bold text-theme-text-primary">Invia Preventivo via WhatsApp</h3>
              <p className="text-sm text-theme-text-muted">{selectedPreventivo.vehicle_name} - {formatEur(selectedPreventivo.total_final)}</p>

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

              <div className="bg-theme-bg-primary rounded p-3 text-xs text-theme-text-muted whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                {buildDefaultPreventivoMessage(selectedPreventivo)}
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => { setShowPhoneModal(false); setWhatsappPhone('') }}>
                  Annulla
                </Button>
                <Button
                  disabled={!whatsappPhone.trim() || sendingWhatsapp}
                  onClick={() => handleSendWhatsApp(selectedPreventivo, whatsappPhone.trim())}
                >
                  {sendingWhatsapp ? 'Invio...' : 'Invia WhatsApp'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ═══ FORM VIEW (Nuovo / Modifica Preventivo) ═══
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-theme-text-primary">{editingId ? 'Modifica Preventivo' : 'Nuovo Preventivo'}</h2>
        <Button variant="secondary" onClick={() => { setView('list'); setEditingId(null); resetForm() }}>Torna alla Lista</Button>
      </div>

      {/* Vehicle + Fascia/Customer combined dropdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Veicolo *"
          value={form.vehicle_id}
          onChange={(e) => setForm(prev => ({ ...prev, vehicle_id: e.target.value, insurance_option: '' }))}
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Input label="Data Ritiro *" type="date" value={form.pickup_date} onChange={(e) => setForm(prev => ({ ...prev, pickup_date: e.target.value }))} />
        <Select label="Ora Ritiro" value={form.pickup_time} onChange={(e) => {
          const newPickupTime = e.target.value
          const [h, m] = newPickupTime.split(':').map(Number)
          const d = new Date(); d.setHours(h, m, 0); d.setMinutes(d.getMinutes() - 90)
          const autoReturn = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          setForm(prev => ({ ...prev, pickup_time: newPickupTime, return_time: autoReturn }))
        }} options={PICKUP_SLOTS} />
        <Input label="Data Riconsegna *" type="date" value={form.return_date} onChange={(e) => setForm(prev => ({ ...prev, return_date: e.target.value }))} />
        <Select label="Ora Riconsegna (auto: ritiro -1h30)" value={form.return_time} onChange={(e) => setForm(prev => ({ ...prev, return_time: e.target.value }))} options={RETURN_SLOTS} />
      </div>

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
            <div className="grid grid-cols-2 gap-2">
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
            <div className="grid grid-cols-2 gap-2">
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
            <span className="text-sm text-theme-text-primary">Lavaggio ({formatEur(configOverlay.lavaggioFee)})</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-theme-border/50 hover:bg-theme-bg-tertiary/30">
            <input type="checkbox" checked={form.include_no_cauzione} onChange={(e) => setForm(prev => ({ ...prev, include_no_cauzione: e.target.checked }))} className="w-4 h-4 accent-dr7-gold" />
            <span className="text-sm text-theme-text-primary">No Cauzione ({formatEur(configOverlay.noCauzionePerDay)}/giorno)</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-theme-border/50 hover:bg-theme-bg-tertiary/30">
            <input type="checkbox" checked={form.include_unlimited_km} onChange={(e) => setForm(prev => ({ ...prev, include_unlimited_km: e.target.checked }))} className="w-4 h-4 accent-dr7-gold" />
            <span className="text-sm text-theme-text-primary">
              Km Illimitati ({formatEur(getUnlimitedKmPriceForVehicle(selectedVehicle, form.driver_tier, rentalConfig, configOverlay))}/giorno)
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-theme-border/50 hover:bg-theme-bg-tertiary/30">
            <input type="checkbox" checked={form.include_second_driver} onChange={(e) => setForm(prev => ({ ...prev, include_second_driver: e.target.checked }))} className="w-4 h-4 accent-dr7-gold" />
            <span className="text-sm text-theme-text-primary">
              Secondo Guidatore ({formatEur(form.driver_tier === 'TIER_2' ? configOverlay.secondDriverTier2 : configOverlay.secondDriverTier1)}/giorno)
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-theme-border/50 hover:bg-theme-bg-tertiary/30">
            <input type="checkbox" checked={form.include_dr7_flex} onChange={(e) => setForm(prev => ({ ...prev, include_dr7_flex: e.target.checked }))} className="w-4 h-4 accent-dr7-gold" />
            <span className="text-sm text-theme-text-primary">
              DR7 FLEX — Cancellazione Premium ({formatEur(configOverlay.dr7FlexPerDay)}/giorno)
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

        {/* Revenue coefficients applied to total */}
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
              <span>Coefficiente combinato: x{pricing.revenueCoeff.toFixed(4)}</span>
              <span>{pricing.revenueCoeff < 1 ? `-${formatEur(pricing.listSubtotal - pricing.listSubtotal * pricing.revenueCoeff)}` : `+${formatEur(pricing.listSubtotal * pricing.revenueCoeff - pricing.listSubtotal)}`}</span>
            </div>
          </>
        )}

        <div className="border-t border-theme-border pt-2 flex justify-between text-theme-text-primary font-semibold">
          <span>Subtotale</span>
          <span>{formatEur(pricing.afterRevenue)}</span>
        </div>

        {pricing.maggiorazione > 0 && (
          <div className="flex justify-between text-sm text-dr7-gold">
            <span>Maggiorazione preventivo (+{pricing.maggiorazione}%)</span>
            <span>+{formatEur(pricing.maggiorazioneAmount)}</span>
          </div>
        )}

        {/* Sconto */}
        <div className="grid grid-cols-2 gap-3 pt-2">
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

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <Button variant="secondary" onClick={() => { setView('list'); setEditingId(null); resetForm() }}>Annulla</Button>
        <Button disabled={saving || !form.vehicle_id || rentalDays < 1} onClick={() => handleSave(false)}>
          {saving ? 'Salvataggio...' : (editingId ? 'Aggiorna Preventivo' : 'Salva Preventivo')}
        </Button>
        {!editingId && (
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
            title={
              !selectedCustomerId
                ? 'Seleziona un cliente sopra (campo Fascia)'
                : !customers.find((c: any) => c.id === selectedCustomerId)?.phone
                  ? 'Il cliente selezionato non ha un numero di telefono'
                  : ''
            }
          >
            {saving || sendingWhatsapp ? 'Invio...' : 'Salva e invia'}
          </Button>
        )}
      </div>
    </div>
  )
}
