import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { useRentalConfig } from '../../../hooks/useRentalConfig'
import { buildConfigOverlay } from '../../../utils/configOverlay'
import Input from './Input'
import Select from './Select'
import Button from './Button'

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
  created_by: string | null
  created_at: string
  updated_at: string
  expires_at: string | null
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

function isFurgone(vehicle?: Vehicle): boolean {
  if (!vehicle) return false
  const name = vehicle.display_name.toLowerCase()
  return name.includes('ducato') || name.includes('vito') || name.includes('furgone')
}

function getInsuranceOptionsForVehicle(
  vehicle: Vehicle | undefined,
  tier: DriverTier,
  overlay: ReturnType<typeof buildConfigOverlay>
): InsuranceOpt[] {
  const t1 = overlay.insuranceTier1
  const t2 = overlay.insuranceTier2
  const urban = overlay.urbanInsurance
  const util = overlay.utilitaireInsurance
  const furg = overlay.furgoneInsurance

  if (!vehicle) return tier === 'TIER_2' ? t2 : t1
  if (isFurgone(vehicle)) return furg
  if (vehicle.category === 'aziendali') return util
  if (vehicle.category === 'urban') return urban

  const name = vehicle.display_name.toLowerCase()
  if (name.includes('panda') || name.includes('captur') || name.includes('clio') ||
    name.includes('citroen') || name.includes('208') || name.includes('urban')) {
    return urban
  }

  return tier === 'TIER_2' ? t2 : t1
}

function getUnlimitedKmPrice(vehicle: Vehicle | undefined, tier: DriverTier, overlay: ReturnType<typeof buildConfigOverlay>): number {
  if (!vehicle) return tier === 'TIER_2' ? overlay.unlimitedKmTier2 : overlay.unlimitedKmTier1
  if (vehicle.category === 'urban') return 0
  const name = vehicle.display_name.toLowerCase()
  if (name.includes('vito') || name.includes('mercedes') || name.includes('ncc') || name.includes('tourer')) return 189
  if (isFurgone(vehicle)) return 94.50
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

export default function PreventiviTab({ onConvertToBooking }: Props) {
  const [view, setView] = useState<'list' | 'form'>('list')
  const [preventivi, setPreventivi] = useState<Preventivo[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false)
  const [selectedPreventivo, setSelectedPreventivo] = useState<Preventivo | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [showPhoneModal, setShowPhoneModal] = useState(false)

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
    () => getInsuranceOptionsForVehicle(selectedVehicle, form.driver_tier, configOverlay),
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
    const baseDailyRate = revenueData?.finalDailyRateEur
      ?? (selectedVehicle ? selectedVehicle.daily_rate / 100 : 0)
    const maggiorazione = parseFloat(form.maggiorazione_pct) || 0
    const dailyAfterMarkup = Math.round(baseDailyRate * (1 + maggiorazione / 100) * 100) / 100
    const rentalTotal = Math.round(dailyAfterMarkup * rentalDays * 100) / 100

    const selectedIns = insuranceOptions.find(i => i.id === form.insurance_option)
    const insuranceDailyPrice = selectedIns?.pricePerDay ?? 0
    const insuranceTotal = Math.round(insuranceDailyPrice * rentalDays * 100) / 100

    const lavaggioFee = form.include_lavaggio ? configOverlay.lavaggioFee : 0

    const noCauzioneDaily = form.include_no_cauzione ? configOverlay.noCauzionePerDay : 0
    const noCauzioneTotal = Math.round(noCauzioneDaily * rentalDays * 100) / 100

    const unlimitedKmDaily = form.include_unlimited_km
      ? getUnlimitedKmPrice(selectedVehicle, form.driver_tier, configOverlay)
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

    const subtotal = Math.round((rentalTotal + insuranceTotal + lavaggioFee + noCauzioneTotal + unlimitedKmTotal + secondDriverTotal + dr7FlexTotal + deliveryFee + pickupFee + experienceCost) * 100) / 100
    const sconto = parseFloat(form.sconto) || 0
    const totalFinal = Math.round((subtotal - sconto) * 100) / 100

    return {
      baseDailyRate,
      maggiorazione,
      dailyAfterMarkup,
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
      subtotal,
      sconto,
      totalFinal,
    }
  }, [form, rentalDays, revenueData, selectedVehicle, insuranceOptions, configOverlay])

  // ─── Data Loading ─────────────────────────────────────────────────────────

  useEffect(() => {
    loadPreventivi()
    loadVehicles()
  }, [])

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

  async function handleSave() {
    if (!form.vehicle_id || !form.pickup_date || !form.return_date) {
      toast.error('Seleziona veicolo e date')
      return
    }
    if (rentalDays < 1) {
      toast.error('Date non valide')
      return
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
      }

      const { data, error } = await supabase
        .from('preventivi')
        .insert([record])
        .select()
        .single()

      if (error) throw error
      toast.success('Preventivo salvato!')
      setPreventivi(prev => [data, ...prev])
      setView('list')
      resetForm()
    } catch (error: unknown) {
      console.error('Failed to save preventivo:', error)
      toast.error('Errore salvataggio preventivo')
    } finally {
      setSaving(false)
    }
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

  function formatWhatsAppMessage(p: Preventivo): string {
    const specs = [
      p.vehicle_name,
      p.vehicle_model_year ? `my ${p.vehicle_model_year}` : '',
      p.vehicle_cv ? `${p.vehicle_cv}cv` : '',
      p.vehicle_0_100 ? `0-100 ${String(p.vehicle_0_100).replace('.', ',')}s` : '',
    ].filter(Boolean).join(' ')

    let msg = `Preventivo ${specs}\n\n`
    msg += `${p.rental_days}gg x ${formatEur(p.daily_rate_after_markup || p.base_daily_rate)}/g = ${formatEur((p.daily_rate_after_markup || p.base_daily_rate) * p.rental_days)}\n`

    if (p.insurance_total > 0) {
      const insLabel = insuranceOptions.find(i => i.id === p.insurance_option)?.label || p.insurance_option || 'Kasko'
      msg += `${insLabel} = ${formatEur(p.insurance_total)}\n`
    }

    if (p.lavaggio_fee > 0) msg += `Lavaggio = ${formatEur(p.lavaggio_fee)}\n`
    if (p.no_cauzione_total > 0) msg += `No cauzione = ${formatEur(p.no_cauzione_total)}\n`
    if (p.unlimited_km_total > 0) msg += `Km illimitati = ${formatEur(p.unlimited_km_total)}\n`
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

  async function handleSendWhatsApp(preventivo: Preventivo, phone: string) {
    setSendingWhatsapp(true)
    try {
      const message = formatWhatsAppMessage(preventivo)

      const response = await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPhone: phone, customMessage: message })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Errore invio WhatsApp')

      const expiryHours = configOverlay.defaultExpiryHours || 24
      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString()

      await supabase
        .from('preventivi')
        .update({
          status: 'inviato',
          customer_phone: phone,
          whatsapp_sent_at: new Date().toISOString(),
          whatsapp_message_id: result.messageId || null,
          expires_at: expiresAt,
        })
        .eq('id', preventivo.id)

      toast.success('Preventivo inviato via WhatsApp!')
      setShowPhoneModal(false)
      setWhatsappPhone('')
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

  async function updateStatus(id: string, newStatus: string) {
    await supabase.from('preventivi').update({ status: newStatus }).eq('id', id)
    loadPreventivi()
    toast.success(`Stato aggiornato: ${STATUS_LABELS[newStatus]}`)
  }

  const filtered = useMemo(
    () => statusFilter === 'all' ? preventivi : preventivi.filter(p => p.status === statusFilter),
    [preventivi, statusFilter]
  )

  // ─── RENDER ─────────────────────────────────────────────────────────────

  // ═══ LIST VIEW ═══
  if (view === 'list') {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-2xl font-bold text-theme-text-primary">Preventivi</h2>
          <Button onClick={() => { resetForm(); setView('form') }}>+ Nuovo Preventivo</Button>
        </div>

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
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Giorni</th>
                  <th className="py-2 px-3 text-right">Totale</th>
                  <th className="py-2 px-3 text-right">Sconto</th>
                  <th className="py-2 px-3 text-right">Finale</th>
                  <th className="py-2 px-3">Stato</th>
                  <th className="py-2 px-3">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b border-theme-border/50 hover:bg-theme-bg-hover/30">
                    <td className="py-2 px-3">
                      <div className="font-medium text-theme-text-primary">{p.vehicle_name}</div>
                      {p.vehicle_plate && <div className="text-xs text-theme-text-muted">{p.vehicle_plate}</div>}
                    </td>
                    <td className="py-2 px-3 text-theme-text-muted">
                      {new Date(p.pickup_date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}
                      {' - '}
                      {new Date(p.dropoff_date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}
                    </td>
                    <td className="py-2 px-3 text-theme-text-muted">{p.rental_days}gg</td>
                    <td className="py-2 px-3 text-right text-theme-text-primary">{formatEur(p.subtotal)}</td>
                    <td className="py-2 px-3 text-right text-red-400">{p.sconto > 0 ? `-${formatEur(p.sconto)}` : '-'}</td>
                    <td className="py-2 px-3 text-right font-bold text-theme-text-primary">{formatEur(p.total_final)}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status] || 'bg-gray-600'}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1 flex-wrap">
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Phone Modal */}
        {showPhoneModal && selectedPreventivo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-theme-bg-secondary rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
              <h3 className="text-lg font-bold text-theme-text-primary">Invia Preventivo via WhatsApp</h3>
              <p className="text-sm text-theme-text-muted">{selectedPreventivo.vehicle_name} - {formatEur(selectedPreventivo.total_final)}</p>

              <Input
                label="Numero di Telefono"
                type="tel"
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
                placeholder="393xxxxxxxxx"
              />

              <div className="bg-theme-bg-primary rounded p-3 text-xs text-theme-text-muted whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                {formatWhatsAppMessage(selectedPreventivo)}
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

  // ═══ FORM VIEW (Nuovo Preventivo) ═══
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-theme-text-primary">Nuovo Preventivo</h2>
        <Button variant="secondary" onClick={() => setView('list')}>Torna alla Lista</Button>
      </div>

      {/* Vehicle Selection — ALL vehicles, no availability check */}
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
        <Select
          label="Fascia Cliente"
          value={form.driver_tier}
          onChange={(e) => setForm(prev => ({ ...prev, driver_tier: e.target.value as DriverTier, insurance_option: '' }))}
          options={[
            { value: 'TIER_2', label: 'Fascia A (26-69, patente 5+ anni)' },
            { value: 'TIER_1', label: 'Fascia B (21-25 o patente 3-4 anni)' },
          ]}
        />
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
        <Input label="Ora Ritiro" type="time" value={form.pickup_time} onChange={(e) => setForm(prev => ({ ...prev, pickup_time: e.target.value }))} />
        <Input label="Data Riconsegna *" type="date" value={form.return_date} onChange={(e) => setForm(prev => ({ ...prev, return_date: e.target.value }))} />
        <Input label="Ora Riconsegna" type="time" value={form.return_time} onChange={(e) => setForm(prev => ({ ...prev, return_time: e.target.value }))} />
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
      {revenueData && (
        <div className="p-3 bg-theme-bg-tertiary/50 border border-dr7-gold/30 rounded-lg text-sm space-y-1">
          <p className="font-semibold text-dr7-gold">Revenue Management</p>
          <p className="text-theme-text-primary">
            Tariffa giornaliera: <strong>{formatEur(revenueData.finalDailyRateEur)}</strong> /giorno
          </p>
          {revenueData.breakdown?.map((b, i) => (
            <p key={i} className="text-theme-text-muted text-xs">
              {b.label}: x{b.coeff.toFixed(2)} ({b.description})
            </p>
          ))}
        </div>
      )}

      {/* Maggiorazione */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Maggiorazione Preventivo (%)"
          type="number"
          step="0.1"
          value={form.maggiorazione_pct}
          onChange={(e) => setForm(prev => ({ ...prev, maggiorazione_pct: e.target.value }))}
          placeholder="0"
        />
        <div className="flex items-end">
          <p className="text-sm text-theme-text-muted pb-2">
            Tariffa dopo maggiorazione: <strong className="text-theme-text-primary">{formatEur(pricing.dailyAfterMarkup)}</strong> /giorno
          </p>
        </div>
      </div>

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
              Km Illimitati ({formatEur(getUnlimitedKmPrice(selectedVehicle, form.driver_tier, configOverlay))}/giorno)
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
          <span>{rentalDays}gg x {formatEur(pricing.dailyAfterMarkup)}/giorno</span>
          <span>{formatEur(pricing.rentalTotal)}</span>
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

        <div className="border-t border-theme-border pt-2 flex justify-between text-theme-text-primary font-semibold">
          <span>Subtotale</span>
          <span>{formatEur(pricing.subtotal)}</span>
        </div>

        {/* Sconto */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Input label="Sconto (€)" type="number" step="0.01" value={form.sconto} onChange={(e) => setForm(prev => ({ ...prev, sconto: e.target.value }))} placeholder="0" />
          <Input label="Nota sconto" value={form.sconto_note} onChange={(e) => setForm(prev => ({ ...prev, sconto_note: e.target.value }))} placeholder="valido solo 24h" />
        </div>

        {pricing.sconto > 0 && (
          <div className="flex justify-between text-sm text-red-400">
            <span>Sconto {form.sconto_note && `(${form.sconto_note})`}</span>
            <span>-{formatEur(pricing.sconto)}</span>
          </div>
        )}

        <div className="border-t border-dr7-gold/50 pt-2 flex justify-between text-xl font-bold text-dr7-gold">
          <span>TOTALE FINALE</span>
          <span>{formatEur(pricing.totalFinal)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <Button variant="secondary" onClick={() => setView('list')}>Annulla</Button>
        <Button disabled={saving || !form.vehicle_id || rentalDays < 1} onClick={handleSave}>
          {saving ? 'Salvataggio...' : 'Salva Preventivo'}
        </Button>
      </div>
    </div>
  )
}
