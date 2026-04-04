import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import Select from './Select'
import Button from './Button'
import { useRentalConfig } from '../../../hooks/useRentalConfig'
import { getKmIncluded } from '../../../utils/configLookup'

// --- Types ---
type Fascia = 'A' | 'B'
type KaskoTier = 'RCA' | 'KASKO_BASE' | 'KASKO_BLACK' | 'KASKO_SIGNATURE' | 'DR7'

interface Vehicle {
  id: string
  display_name: string
  plate: string | null
  targa?: string | null
  status: 'available' | 'rented' | 'maintenance' | 'retired'
  daily_rate: number
  category?: 'exotic' | 'urban' | 'aziendali'
}

type CauzioneType = 'no_cauzione' | 'carta_debito_credito' | 'contanti_prepagata' | 'carta_credito_non_residente'

interface PreventivoData {
  id?: string
  vehicle_id: string
  vehicle_name: string
  vehicle_plate: string
  vehicle_category: string
  fascia: Fascia
  pickup_date: string
  pickup_time: string
  return_date: string
  return_time: string
  pickup_location: string
  dropoff_location: string
  insurance_option: KaskoTier
  insurance_daily: string
  km_limit: string
  unlimited_km: boolean
  km_overage_fee: string
  unlimited_km_daily: string
  second_driver: boolean
  second_driver_daily: string
  no_cauzione: boolean
  no_cauzione_daily: string
  cauzione_type: CauzioneType
  residente_sardegna: boolean
  delivery_enabled: boolean
  delivery_street: string
  delivery_city: string
  delivery_zip: string
  delivery_province: string
  delivery_notes: string
  delivery_fee: string
  pickup_enabled: boolean
  pickup_street: string
  pickup_city: string
  pickup_zip: string
  pickup_province: string
  pickup_notes: string
  pickup_fee: string
  daily_rate: string
  total_amount: string
  deposit_amount: string
  notes: string
  valid_until: string
}

// --- Insurance by Fascia & Category ---
// Exotic / Supercar
const EXOTIC_INSURANCE_FASCIA_A = [
  { id: 'RCA', label: 'RCA Compresa', pricePerDay: 0 },
  { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 89 },
  { id: 'KASKO_BLACK', label: 'Kasko Black', pricePerDay: 149 },
  { id: 'KASKO_SIGNATURE', label: 'Kasko Signature', pricePerDay: 189 },
  { id: 'DR7', label: 'Kasko DR7', pricePerDay: 289 },
]
const EXOTIC_INSURANCE_FASCIA_B = [
  { id: 'RCA', label: 'RCA Compresa', pricePerDay: 0 },
  { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 119 },
]

// Urban
const URBAN_INSURANCE = [
  { id: 'RCA', label: 'RCA Compresa', pricePerDay: 0 },
  { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 15 },
  { id: 'DR7', label: 'Kasko DR7', pricePerDay: 45 },
]

// Utilitaire / Furgone
const UTIL_INSURANCE = [
  { id: 'RCA', label: 'RCA Compresa', pricePerDay: 0 },
  { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 45 },
  { id: 'DR7', label: 'Kasko DR7', pricePerDay: 90 },
]

// --- Fascia-specific extras (exotic) ---
const FASCIA_EXTRAS = {
  A: { secondDriver: 10, unlimitedKm: 189, noCauzione: 49 },
  B: { secondDriver: 20, unlimitedKm: 289, noCauzione: 0 },
}

// --- Cauzione amounts by type, fascia, and residency ---
const CAUZIONE_AMOUNTS: Record<CauzioneType, { A: number; B: number }> = {
  no_cauzione: { A: 0, B: 0 }, // No deposit, but €49/day surcharge (Fascia A only)
  carta_debito_credito: { A: 1000, B: 2000 },
  contanti_prepagata: { A: 4999, B: 4999 },
  carta_credito_non_residente: { A: 3500, B: 5000 },
}

// --- Locations ---
const LOCATIONS = [
  { value: 'dr7_office', label: 'Viale Marconi, 229, 09131 Cagliari CA' },
  { value: 'cagliari_airport', label: 'Aeroporto di Cagliari Elmas (+€50)' },
]

// --- Time Options ---
const TIME_OPTIONS = Array.from({ length: 96 }).map((_, i) => {
  const hour = Math.floor(i / 4).toString().padStart(2, '0')
  const minute = ((i % 4) * 15).toString().padStart(2, '0')
  const time = `${hour}:${minute}`
  return { value: time, label: time }
})

function isFurgone(vehicle?: Vehicle): boolean {
  if (!vehicle) return false
  const name = vehicle.display_name.toLowerCase()
  return name.includes('ducato') || name.includes('vito') || name.includes('furgone')
}

function getVehicleType(vehicle?: Vehicle): 'exotic' | 'urban' | 'util' | 'furgone' {
  if (!vehicle) return 'exotic'
  if (isFurgone(vehicle)) return 'furgone'
  if (vehicle.category === 'urban') return 'urban'
  if (vehicle.category === 'aziendali') return 'util'
  // Fallback name check
  const name = vehicle.display_name.toLowerCase()
  if (name.includes('panda') || name.includes('captur') || name.includes('clio') || name.includes('208')) return 'urban'
  return 'exotic'
}

function getInsuranceOptionsForPreventivo(vehicleType: string, fascia: Fascia) {
  if (vehicleType === 'exotic') {
    return fascia === 'A' ? EXOTIC_INSURANCE_FASCIA_A : EXOTIC_INSURANCE_FASCIA_B
  }
  if (vehicleType === 'urban') return URBAN_INSURANCE
  return UTIL_INSURANCE // util & furgone same
}

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

function calculateReturnTime(pickupTime: string): string {
  if (!pickupTime) return ''
  const [hours, minutes] = pickupTime.split(':').map(Number)
  const tempDate = new Date()
  tempDate.setHours(hours, minutes, 0)
  tempDate.setMinutes(tempDate.getMinutes() - 90)
  return `${String(tempDate.getHours()).padStart(2, '0')}:${String(tempDate.getMinutes()).padStart(2, '0')}`
}

// Calculate rental days from dates (ceil like booking form)
function calculateRentalDays(pickupDate: string, pickupTime: string, returnDate: string, returnTime: string): number {
  if (!pickupDate || !returnDate) return 0
  const start = new Date(`${pickupDate}T${pickupTime || '10:00'}:00`)
  const end = new Date(`${returnDate}T${returnTime || '10:00'}:00`)
  const diffMs = end.getTime() - start.getTime()
  if (diffMs <= 0) return 0
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}

// Default validity: 7 days from now
function defaultValidUntil(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().split('T')[0]
}

// Today's date for min date validation
function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

// Get deposit amount based on cauzione type, fascia, and residency
function getCauzioneDeposit(type: CauzioneType, fascia: Fascia, residente: boolean): number {
  if (type === 'no_cauzione') return 0
  if (!residente) {
    // Non-residente: only carta_credito_non_residente option
    return CAUZIONE_AMOUNTS.carta_credito_non_residente[fascia]
  }
  return CAUZIONE_AMOUNTS[type]?.[fascia] || 0
}

const initialFormData: PreventivoData = {
  vehicle_id: '',
  vehicle_name: '',
  vehicle_plate: '',
  vehicle_category: '',
  fascia: 'A',
  pickup_date: '',
  pickup_time: getNext15MinuteTime(),
  return_date: '',
  return_time: '10:00',
  pickup_location: 'dr7_office',
  dropoff_location: 'dr7_office',
  insurance_option: 'KASKO_BASE',
  insurance_daily: '0',
  km_limit: '0',
  unlimited_km: false,
  km_overage_fee: '1.80',
  unlimited_km_daily: '0',
  second_driver: false,
  second_driver_daily: '0',
  no_cauzione: false,
  no_cauzione_daily: '0',
  cauzione_type: 'carta_debito_credito',
  residente_sardegna: true,
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
  daily_rate: '0',
  total_amount: '0',
  deposit_amount: '0',
  notes: '',
  valid_until: defaultValidUntil(),
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  editData?: any // For editing existing preventivo
}

export default function PreventivoModal({ isOpen, onClose, onSaved, editData }: Props) {
  const [form, setForm] = useState<PreventivoData>(initialFormData)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [saving, setSaving] = useState(false)

  // Load vehicles
  useEffect(() => {
    if (!isOpen) return
    ;(async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('id, display_name, plate, targa, status, daily_rate, category')
        .in('status', ['available', 'rented'])
        .order('display_name')
      if (data) setVehicles(data)
    })()
  }, [isOpen])

  // Pre-fill if editing
  useEffect(() => {
    if (editData && isOpen) {
      setForm({
        ...initialFormData,
        ...editData,
        pickup_date: editData.pickup_date ? new Date(editData.pickup_date).toISOString().split('T')[0] : '',
        pickup_time: editData.pickup_date ? new Date(editData.pickup_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }) : getNext15MinuteTime(),
        return_date: editData.dropoff_date ? new Date(editData.dropoff_date).toISOString().split('T')[0] : '',
        return_time: editData.dropoff_date ? new Date(editData.dropoff_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }) : '10:00',
        daily_rate: editData.daily_rate?.toString() || '0',
        total_amount: editData.total_amount?.toString() || '0',
        deposit_amount: editData.deposit_amount?.toString() || '0',
        insurance_daily: editData.insurance_daily?.toString() || '0',
        km_overage_fee: editData.km_overage_fee?.toString() || '1.80',
        km_limit: editData.km_limit?.toString() || '0',
        unlimited_km_daily: editData.unlimited_km_daily?.toString() || '0',
        second_driver_daily: editData.second_driver_daily?.toString() || '0',
        no_cauzione_daily: editData.no_cauzione_daily?.toString() || '0',
        delivery_fee: editData.delivery_fee?.toString() || '0',
        pickup_fee: editData.pickup_fee?.toString() || '0',
        delivery_street: editData.delivery_address?.street || '',
        delivery_city: editData.delivery_address?.city || '',
        delivery_zip: editData.delivery_address?.zip || '',
        delivery_province: editData.delivery_address?.province || '',
        delivery_notes: editData.delivery_address?.notes || '',
        pickup_street: editData.pickup_address?.street || '',
        pickup_city: editData.pickup_address?.city || '',
        pickup_zip: editData.pickup_address?.zip || '',
        pickup_province: editData.pickup_address?.province || '',
        pickup_notes: editData.pickup_address?.notes || '',
      })
    } else if (isOpen) {
      setForm(initialFormData)
    }
  }, [editData, isOpen])

  // Rental config from Centralina (for KM auto-calculation)
  const { config: rentalConfig } = useRentalConfig()

  // Selected vehicle
  const selectedVehicle = useMemo(() => vehicles.find(v => v.id === form.vehicle_id), [vehicles, form.vehicle_id])
  const vehicleType = useMemo(() => getVehicleType(selectedVehicle), [selectedVehicle])

  // Insurance options based on vehicle type + fascia
  const insuranceOptions = useMemo(() => getInsuranceOptionsForPreventivo(vehicleType, form.fascia), [vehicleType, form.fascia])

  // Rental days
  const rentalDays = useMemo(() => calculateRentalDays(form.pickup_date, form.pickup_time, form.return_date, form.return_time), [form.pickup_date, form.pickup_time, form.return_date, form.return_time])

  // Auto-calculate KM from rentalConfig when dates or vehicle change
  useEffect(() => {
    if (!rentalDays || rentalDays <= 0 || form.unlimited_km) return
    // Map vehicleType to config key
    const kmCategory = vehicleType === 'util' ? '_global' : vehicleType
    const km = getKmIncluded(rentalConfig, rentalDays, kmCategory)
    if (km === 'unlimited') {
      setForm(prev => ({ ...prev, unlimited_km: true, km_limit: '0', km_overage_fee: '0' }))
    } else if (km > 0) {
      setForm(prev => ({ ...prev, km_limit: km.toString() }))
    }
  }, [rentalDays, vehicleType, rentalConfig])

  // When vehicle changes, update daily rate and reset insurance
  useEffect(() => {
    if (!selectedVehicle) return
    const rate = selectedVehicle.daily_rate.toFixed(2)
    const options = getInsuranceOptionsForPreventivo(getVehicleType(selectedVehicle), form.fascia)
    const currentValid = options.find(o => o.id === form.insurance_option)
    const insurance = currentValid || options[0]
    const isExotic = getVehicleType(selectedVehicle) === 'exotic'
    const extras = FASCIA_EXTRAS[form.fascia]
    const deposit = getCauzioneDeposit(form.cauzione_type, form.fascia, form.residente_sardegna)

    setForm(prev => ({
      ...prev,
      vehicle_name: selectedVehicle.display_name,
      vehicle_plate: selectedVehicle.plate || selectedVehicle.targa || '',
      vehicle_category: selectedVehicle.category || 'exotic',
      daily_rate: rate,
      insurance_option: insurance.id as KaskoTier,
      insurance_daily: insurance.pricePerDay.toString(),
      deposit_amount: deposit.toString(),
      second_driver_daily: isExotic ? extras.secondDriver.toString() : '0',
      unlimited_km_daily: isExotic ? extras.unlimitedKm.toString() : '0',
      no_cauzione_daily: isExotic && form.fascia === 'A' ? extras.noCauzione.toString() : '0',
    }))
  }, [selectedVehicle])

  // When fascia changes, recalculate insurance + extras + cauzione
  useEffect(() => {
    if (!selectedVehicle) return
    const options = getInsuranceOptionsForPreventivo(getVehicleType(selectedVehicle), form.fascia)
    const currentValid = options.find(o => o.id === form.insurance_option)
    const insurance = currentValid || options[0]
    const isExotic = getVehicleType(selectedVehicle) === 'exotic'
    const extras = FASCIA_EXTRAS[form.fascia]
    const deposit = getCauzioneDeposit(form.cauzione_type, form.fascia, form.residente_sardegna)

    setForm(prev => ({
      ...prev,
      insurance_option: insurance.id as KaskoTier,
      insurance_daily: insurance.pricePerDay.toString(),
      deposit_amount: deposit.toString(),
      second_driver_daily: isExotic ? extras.secondDriver.toString() : prev.second_driver_daily,
      unlimited_km_daily: isExotic ? extras.unlimitedKm.toString() : prev.unlimited_km_daily,
      no_cauzione_daily: isExotic && form.fascia === 'A' ? extras.noCauzione.toString() : '0',
      no_cauzione: form.fascia === 'B' ? false : prev.no_cauzione,
    }))
  }, [form.fascia])

  // When cauzione type or residency changes, recalculate deposit
  useEffect(() => {
    const deposit = getCauzioneDeposit(form.cauzione_type, form.fascia, form.residente_sardegna)
    setForm(prev => ({
      ...prev,
      deposit_amount: deposit.toString(),
      no_cauzione: form.cauzione_type === 'no_cauzione',
      no_cauzione_daily: form.cauzione_type === 'no_cauzione' && form.fascia === 'A' ? FASCIA_EXTRAS.A.noCauzione.toString() : '0',
    }))
  }, [form.cauzione_type, form.residente_sardegna])

  // Auto-calculate total
  const breakdown = useMemo(() => {
    const days = rentalDays || 1
    const baseRate = parseFloat(form.daily_rate || '0')
    const insuranceDaily = parseFloat(form.insurance_daily || '0')
    const deliveryFee = form.delivery_enabled ? parseFloat(form.delivery_fee || '0') : 0
    const pickupFee = form.pickup_enabled ? parseFloat(form.pickup_fee || '0') : 0
    const secondDriverDaily = form.second_driver ? parseFloat(form.second_driver_daily || '0') : 0
    const unlimitedKmDaily = form.unlimited_km ? parseFloat(form.unlimited_km_daily || '0') : 0
    const noCauzioneDaily = form.no_cauzione ? parseFloat(form.no_cauzione_daily || '0') : 0

    const rentalBase = baseRate * days
    const insuranceTotal = insuranceDaily * days
    const secondDriverTotal = secondDriverDaily * days
    const unlimitedKmTotal = unlimitedKmDaily * days
    const noCauzioneTotal = noCauzioneDaily * days
    const total = rentalBase + insuranceTotal + secondDriverTotal + unlimitedKmTotal + noCauzioneTotal + deliveryFee + pickupFee

    return {
      days,
      rentalBase,
      insuranceTotal,
      insuranceDaily,
      secondDriverTotal,
      secondDriverDaily,
      unlimitedKmTotal,
      unlimitedKmDaily,
      noCauzioneTotal,
      noCauzioneDaily,
      deliveryFee,
      pickupFee,
      total,
    }
  }, [form, rentalDays])

  // Sync total_amount with calculated total
  useEffect(() => {
    setForm(prev => ({ ...prev, total_amount: breakdown.total.toFixed(2) }))
  }, [breakdown.total])

  // Save preventivo
  const handleSave = async () => {
    if (!form.vehicle_id) { toast.error('Seleziona un veicolo'); return }
    if (!form.pickup_date || !form.return_date) { toast.error('Seleziona le date'); return }
    if (rentalDays <= 0) { toast.error('La data di riconsegna deve essere dopo il ritiro'); return }

    setSaving(true)
    try {
      // Build ISO dates with time
      const pickupISO = `${form.pickup_date}T${form.pickup_time}:00+02:00`
      const dropoffISO = `${form.return_date}T${form.return_time}:00+02:00`

      const record: any = {
        vehicle_id: form.vehicle_id,
        vehicle_name: form.vehicle_name,
        vehicle_plate: form.vehicle_plate,
        vehicle_category: form.vehicle_category,
        fascia: form.fascia,
        pickup_date: pickupISO,
        dropoff_date: dropoffISO,
        pickup_location: form.pickup_location,
        dropoff_location: form.dropoff_location,
        insurance_option: form.insurance_option,
        insurance_daily: parseFloat(form.insurance_daily),
        km_limit: form.unlimited_km ? 0 : parseInt(form.km_limit) || 0,
        unlimited_km: form.unlimited_km,
        km_overage_fee: parseFloat(form.km_overage_fee),
        unlimited_km_daily: parseFloat(form.unlimited_km_daily),
        second_driver: form.second_driver,
        second_driver_daily: parseFloat(form.second_driver_daily),
        no_cauzione: form.no_cauzione,
        no_cauzione_daily: parseFloat(form.no_cauzione_daily),
        delivery_enabled: form.delivery_enabled,
        delivery_address: form.delivery_enabled ? { street: form.delivery_street, city: form.delivery_city, zip: form.delivery_zip, province: form.delivery_province, notes: form.delivery_notes } : null,
        delivery_fee: form.delivery_enabled ? parseFloat(form.delivery_fee) : 0,
        pickup_enabled: form.pickup_enabled,
        pickup_address: form.pickup_enabled ? { street: form.pickup_street, city: form.pickup_city, zip: form.pickup_zip, province: form.pickup_province, notes: form.pickup_notes } : null,
        pickup_fee: form.pickup_enabled ? parseFloat(form.pickup_fee) : 0,
        daily_rate: parseFloat(form.daily_rate),
        rental_days: rentalDays,
        total_amount: parseFloat(form.total_amount),
        deposit_amount: parseFloat(form.deposit_amount),
        notes: form.notes,
        valid_until: form.valid_until,
        status: 'preventivo',
        updated_at: new Date().toISOString(),
      }

      if (editData?.id) {
        const { error } = await supabase.from('preventivi').update(record).eq('id', editData.id)
        if (error) throw error
      } else {
        record.created_at = new Date().toISOString()
        const { error } = await supabase.from('preventivi').insert(record).select('id').single()
        if (error) throw error
      }

      toast.success('Preventivo salvato!')
      onSaved()
      onClose()
    } catch (err: any) {
      console.error('Error saving preventivo:', err)
      toast.error(`Errore: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8">
      <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-3xl mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-theme-border">
          <h2 className="text-xl font-light text-dr7-gold tracking-[0.2em] uppercase">
            {editData?.id ? 'Modifica Preventivo' : 'Nuovo Preventivo'}
          </h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* FASCIA A / B Toggle */}
          <div className="p-4 rounded-lg border border-theme-border">
            <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 uppercase tracking-wider">Fascia Cliente</h4>
            <div className="flex gap-3">
              {(['A', 'B'] as Fascia[]).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, fascia: f }))}
                  className={`flex-1 py-3 rounded-lg font-bold text-lg transition-all ${
                    form.fascia === f
                      ? f === 'A'
                        ? 'bg-green-600 text-white border-2 border-green-400'
                        : 'bg-orange-600 text-white border-2 border-orange-400'
                      : 'bg-theme-bg-tertiary text-theme-text-muted border border-theme-border hover:border-theme-text-muted'
                  }`}
                >
                  Fascia {f}
                  <span className="block text-xs font-normal mt-1">
                    {f === 'A' ? '26-69 anni, patente ≥5 anni' : '21-25 anni o patente 3-4 anni'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="p-4 rounded-lg border border-theme-border">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Input label="Data Ritiro" type="date" required min={todayStr()} value={form.pickup_date}
                  onChange={(e) => setForm(prev => ({ ...prev, pickup_date: e.target.value }))} />
                <Select label="Ora Ritiro" required value={form.pickup_time}
                  onChange={(e) => {
                    const pt = e.target.value
                    setForm(prev => ({ ...prev, pickup_time: pt, return_time: calculateReturnTime(pt) }))
                  }}
                  options={TIME_OPTIONS} />
              </div>
              <Select label="Luogo Ritiro" required value={form.pickup_location}
                onChange={(e) => setForm(prev => ({ ...prev, pickup_location: e.target.value }))}
                options={LOCATIONS} />
              <div className="space-y-3">
                <Input label="Data Riconsegna" type="date" required min={form.pickup_date}
                  value={form.return_date}
                  onChange={(e) => setForm(prev => ({ ...prev, return_date: e.target.value }))} />
                <Select label="Ora Riconsegna" required value={form.return_time}
                  onChange={(e) => setForm(prev => ({ ...prev, return_time: e.target.value }))}
                  options={TIME_OPTIONS} />
              </div>
              <Select label="Luogo Riconsegna" required value={form.dropoff_location}
                onChange={(e) => setForm(prev => ({ ...prev, dropoff_location: e.target.value }))}
                options={LOCATIONS} />
            </div>
            {rentalDays > 0 && (
              <div className="mt-3 text-sm text-dr7-gold font-semibold">
                Durata: {rentalDays} giorn{rentalDays === 1 ? 'o' : 'i'}
              </div>
            )}
          </div>

          {/* Vehicle Selection */}
          <div className="p-4 rounded-lg border border-theme-border">
            <Select
              label={`Veicolo (${vehicles.length} disponibili)`}
              required
              value={form.vehicle_id}
              onChange={(e) => setForm(prev => ({ ...prev, vehicle_id: e.target.value }))}
              options={[
                { value: '', label: 'Seleziona veicolo...' },
                ...vehicles.map(v => ({
                  value: v.id,
                  label: `${v.display_name}${v.plate || v.targa ? ` (${v.plate || v.targa})` : ''} — €${v.daily_rate.toFixed(2)}/giorno`
                }))
              ]}
            />
            {selectedVehicle && (
              <div className="mt-2 text-sm text-theme-text-muted">
                Categoria: <span className="text-theme-text-primary font-medium capitalize">{vehicleType}</span>
                {' • '}Tariffa giornaliera: <span className="text-dr7-gold font-medium">€{form.daily_rate}</span>
              </div>
            )}
            <div className="mt-3">
              <Input label="Tariffa Giornaliera (€) — Modificabile" type="number" step="0.01"
                value={form.daily_rate}
                onChange={(e) => setForm(prev => ({ ...prev, daily_rate: e.target.value }))} />
            </div>
          </div>

          {/* Insurance */}
          <div className="p-4 rounded-lg border border-theme-border">
            <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 uppercase tracking-wider">Assicurazione</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {insuranceOptions.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, insurance_option: opt.id as KaskoTier, insurance_daily: opt.pricePerDay.toString() }))}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    form.insurance_option === opt.id
                      ? 'border-dr7-gold bg-dr7-gold/10 text-dr7-gold'
                      : 'border-theme-border text-theme-text-muted hover:border-theme-text-muted'
                  }`}
                >
                  <div className="font-semibold text-sm">{opt.label}</div>
                  <div className="text-xs mt-1">{opt.pricePerDay > 0 ? `€${opt.pricePerDay}/giorno` : 'Inclusa'}</div>
                </button>
              ))}
            </div>
          </div>

          {/* KM Limit */}
          <div className="p-4 rounded-lg border border-theme-border">
            <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 uppercase tracking-wider">Chilometraggio</h4>
            {rentalDays > 0 && !form.unlimited_km && parseInt(form.km_limit) > 0 && (
              <p className="text-xs text-dr7-gold mb-3">
                Auto-calcolato: {form.km_limit} km per {rentalDays} giorn{rentalDays === 1 ? 'o' : 'i'}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Limite KM" type="number" value={form.km_limit}
                onChange={(e) => setForm(prev => ({ ...prev, km_limit: e.target.value }))}
                disabled={form.unlimited_km} />
              <Input label="Sforo per KM (€)" type="number" step="0.01" value={form.km_overage_fee}
                onChange={(e) => setForm(prev => ({ ...prev, km_overage_fee: e.target.value }))}
                disabled={form.unlimited_km} />
            </div>
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input type="checkbox" checked={form.unlimited_km}
                onChange={(e) => setForm(prev => ({ ...prev, unlimited_km: e.target.checked, km_overage_fee: e.target.checked ? '0' : '1.80' }))}
                className="w-4 h-4 text-blue-600 bg-theme-bg-tertiary border-theme-border-light rounded" />
              <span className="text-sm text-theme-text-secondary">
                KM Illimitati
                {vehicleType === 'exotic' && <span className="text-dr7-gold ml-1">(+€{FASCIA_EXTRAS[form.fascia].unlimitedKm}/giorno)</span>}
              </span>
            </label>
          </div>

          {/* Extras: Second Driver */}
          <div className="p-4 rounded-lg border border-theme-border">
            <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 uppercase tracking-wider">Opzioni Extra</h4>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.second_driver}
                onChange={(e) => setForm(prev => ({ ...prev, second_driver: e.target.checked }))}
                className="w-4 h-4 text-blue-600 bg-theme-bg-tertiary border-theme-border-light rounded" />
              <span className="text-sm text-theme-text-secondary">
                Secondo Guidatore
                <span className="text-dr7-gold ml-1">(+€{form.second_driver_daily}/giorno)</span>
              </span>
            </label>
          </div>

          {/* Cauzione */}
          <div className="p-4 rounded-lg border border-theme-border">
            <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 uppercase tracking-wider">Cauzione</h4>

            {/* Residente toggle */}
            <div className="flex gap-3 mb-4">
              {([true, false] as const).map(val => (
                <button key={String(val)} type="button"
                  onClick={() => setForm(prev => ({
                    ...prev,
                    residente_sardegna: val,
                    cauzione_type: !val ? 'carta_credito_non_residente' : prev.cauzione_type === 'carta_credito_non_residente' ? 'carta_debito_credito' : prev.cauzione_type,
                  }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    form.residente_sardegna === val
                      ? 'bg-theme-text-primary text-black'
                      : 'bg-theme-bg-tertiary text-theme-text-muted border border-theme-border hover:border-theme-text-muted'
                  }`}
                >
                  {val ? 'Residente Sardegna' : 'Non Residente'}
                </button>
              ))}
            </div>

            {/* Cauzione options for residents */}
            {form.residente_sardegna ? (
              <div className="space-y-2">
                {/* No Cauzione - only Fascia A */}
                {form.fascia === 'A' && (
                  <label className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                    form.cauzione_type === 'no_cauzione' ? 'border-dr7-gold bg-dr7-gold/10' : 'border-theme-border hover:border-theme-text-muted'
                  }`}>
                    <div className="flex items-center gap-2">
                      <input type="radio" name="cauzione" checked={form.cauzione_type === 'no_cauzione'}
                        onChange={() => setForm(prev => ({ ...prev, cauzione_type: 'no_cauzione' }))}
                        className="w-4 h-4 text-dr7-gold" />
                      <div>
                        <div className="text-sm font-medium text-theme-text-primary">No Cauzione</div>
                        <div className="text-xs text-theme-text-muted">26-69 anni, patente ≥5 anni</div>
                      </div>
                    </div>
                    <span className="text-dr7-gold font-bold">+€49/gg</span>
                  </label>
                )}

                {/* Carta debito/credito */}
                <label className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  form.cauzione_type === 'carta_debito_credito' ? 'border-dr7-gold bg-dr7-gold/10' : 'border-theme-border hover:border-theme-text-muted'
                }`}>
                  <div className="flex items-center gap-2">
                    <input type="radio" name="cauzione" checked={form.cauzione_type === 'carta_debito_credito'}
                      onChange={() => setForm(prev => ({ ...prev, cauzione_type: 'carta_debito_credito' }))}
                      className="w-4 h-4 text-dr7-gold" />
                    <div>
                      <div className="text-sm font-medium text-theme-text-primary">Carta di debito o credito</div>
                    </div>
                  </div>
                  <span className="text-theme-text-primary font-bold">€{CAUZIONE_AMOUNTS.carta_debito_credito[form.fascia].toLocaleString()}</span>
                </label>

                {/* Contanti / prepagata */}
                <label className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  form.cauzione_type === 'contanti_prepagata' ? 'border-dr7-gold bg-dr7-gold/10' : 'border-theme-border hover:border-theme-text-muted'
                }`}>
                  <div className="flex items-center gap-2">
                    <input type="radio" name="cauzione" checked={form.cauzione_type === 'contanti_prepagata'}
                      onChange={() => setForm(prev => ({ ...prev, cauzione_type: 'contanti_prepagata' }))}
                      className="w-4 h-4 text-dr7-gold" />
                    <div>
                      <div className="text-sm font-medium text-theme-text-primary">Contanti o carta prepagata</div>
                    </div>
                  </div>
                  <span className="text-theme-text-primary font-bold">€{CAUZIONE_AMOUNTS.contanti_prepagata[form.fascia].toLocaleString()}</span>
                </label>
              </div>
            ) : (
              /* Non-residente: solo carta credito */
              <div className="space-y-2">
                <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-500/30 mb-3">
                  <p className="text-xs text-amber-400 font-medium">Non residente in Sardegna: solo carta di credito o veicolo dal 2020 in poi</p>
                </div>
                <div className="p-3 rounded-lg border border-dr7-gold bg-dr7-gold/10">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-theme-text-primary">Carta di credito</div>
                    <span className="text-theme-text-primary font-bold">€{CAUZIONE_AMOUNTS.carta_credito_non_residente[form.fascia].toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-theme-text-muted mt-1">
                    Fascia {form.fascia}: €{CAUZIONE_AMOUNTS.carta_credito_non_residente[form.fascia].toLocaleString()}
                  </div>
                </div>
              </div>
            )}

            {/* Manual override */}
            <div className="mt-3">
              <Input label="Cauzione (€) — Modificabile" type="number" step="0.01" value={form.deposit_amount}
                onChange={(e) => setForm(prev => ({ ...prev, deposit_amount: e.target.value }))} />
            </div>
          </div>

          {/* Delivery */}
          <div className="p-4 rounded-lg border border-theme-border">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" checked={form.delivery_enabled}
                onChange={(e) => setForm(prev => ({ ...prev, delivery_enabled: e.target.checked, ...(!e.target.checked && { delivery_street: '', delivery_city: '', delivery_zip: '', delivery_province: '', delivery_notes: '', delivery_fee: '0' }) }))}
                className="w-4 h-4 text-dr7-gold bg-theme-bg-tertiary border-theme-border-light rounded" />
              <span className="text-sm font-medium text-theme-text-secondary">Consegna a domicilio</span>
            </label>
            {form.delivery_enabled && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Input label="Via *" required value={form.delivery_street} onChange={(e) => setForm(prev => ({ ...prev, delivery_street: e.target.value }))} />
                <Input label="Città *" required value={form.delivery_city} onChange={(e) => setForm(prev => ({ ...prev, delivery_city: e.target.value }))} />
                <Input label="CAP *" required value={form.delivery_zip} onChange={(e) => setForm(prev => ({ ...prev, delivery_zip: e.target.value }))} maxLength={5} />
                <Input label="Provincia *" required value={form.delivery_province} onChange={(e) => setForm(prev => ({ ...prev, delivery_province: e.target.value.toUpperCase() }))} maxLength={2} />
                <div className="col-span-2">
                  <Input label="Note" value={form.delivery_notes} onChange={(e) => setForm(prev => ({ ...prev, delivery_notes: e.target.value }))} />
                </div>
                <Input label="Costo consegna (€)" type="number" step="0.01" value={form.delivery_fee}
                  onChange={(e) => setForm(prev => ({ ...prev, delivery_fee: e.target.value }))} />
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer mb-3 mt-4">
              <input type="checkbox" checked={form.pickup_enabled}
                onChange={(e) => setForm(prev => ({ ...prev, pickup_enabled: e.target.checked, ...(!e.target.checked && { pickup_street: '', pickup_city: '', pickup_zip: '', pickup_province: '', pickup_notes: '', pickup_fee: '0' }) }))}
                className="w-4 h-4 text-dr7-gold bg-theme-bg-tertiary border-theme-border-light rounded" />
              <span className="text-sm font-medium text-theme-text-secondary">Ritiro a domicilio</span>
            </label>
            {form.pickup_enabled && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Input label="Via *" required value={form.pickup_street} onChange={(e) => setForm(prev => ({ ...prev, pickup_street: e.target.value }))} />
                <Input label="Città *" required value={form.pickup_city} onChange={(e) => setForm(prev => ({ ...prev, pickup_city: e.target.value }))} />
                <Input label="CAP *" required value={form.pickup_zip} onChange={(e) => setForm(prev => ({ ...prev, pickup_zip: e.target.value }))} maxLength={5} />
                <Input label="Provincia *" required value={form.pickup_province} onChange={(e) => setForm(prev => ({ ...prev, pickup_province: e.target.value.toUpperCase() }))} maxLength={2} />
                <div className="col-span-2">
                  <Input label="Note" value={form.pickup_notes} onChange={(e) => setForm(prev => ({ ...prev, pickup_notes: e.target.value }))} />
                </div>
                <Input label="Costo ritiro (€)" type="number" step="0.01" value={form.pickup_fee}
                  onChange={(e) => setForm(prev => ({ ...prev, pickup_fee: e.target.value }))} />
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="p-4 rounded-lg border border-theme-border">
            <Input label="Note" value={form.notes} onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Note interne sul preventivo..." />
            <div className="mt-3">
              <Input label="Valido fino al" type="date" value={form.valid_until}
                onChange={(e) => setForm(prev => ({ ...prev, valid_until: e.target.value }))} />
            </div>
          </div>

          {/* PRICE BREAKDOWN */}
          <div className="p-4 rounded-lg border-2 border-dr7-gold/50 bg-dr7-gold/5">
            <h4 className="text-sm font-bold text-dr7-gold uppercase tracking-wider mb-3">Riepilogo Preventivo</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-theme-text-muted">Noleggio base ({breakdown.days}g × €{form.daily_rate})</span>
                <span className="font-mono text-theme-text-primary">€{breakdown.rentalBase.toFixed(2)}</span>
              </div>
              {breakdown.insuranceDaily > 0 && (
                <div className="flex justify-between">
                  <span className="text-theme-text-muted">{form.insurance_option} ({breakdown.days}g × €{breakdown.insuranceDaily})</span>
                  <span className="font-mono text-theme-text-primary">€{breakdown.insuranceTotal.toFixed(2)}</span>
                </div>
              )}
              {form.second_driver && breakdown.secondDriverDaily > 0 && (
                <div className="flex justify-between">
                  <span className="text-theme-text-muted">Secondo Guidatore ({breakdown.days}g × €{breakdown.secondDriverDaily})</span>
                  <span className="font-mono text-theme-text-primary">€{breakdown.secondDriverTotal.toFixed(2)}</span>
                </div>
              )}
              {form.unlimited_km && breakdown.unlimitedKmDaily > 0 && (
                <div className="flex justify-between">
                  <span className="text-theme-text-muted">KM Illimitati ({breakdown.days}g × €{breakdown.unlimitedKmDaily})</span>
                  <span className="font-mono text-theme-text-primary">€{breakdown.unlimitedKmTotal.toFixed(2)}</span>
                </div>
              )}
              {form.no_cauzione && breakdown.noCauzioneDaily > 0 && (
                <div className="flex justify-between">
                  <span className="text-theme-text-muted">No Cauzione ({breakdown.days}g × €{breakdown.noCauzioneDaily})</span>
                  <span className="font-mono text-theme-text-primary">€{breakdown.noCauzioneTotal.toFixed(2)}</span>
                </div>
              )}
              {breakdown.deliveryFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-theme-text-muted">Consegna a domicilio</span>
                  <span className="font-mono text-theme-text-primary">€{breakdown.deliveryFee.toFixed(2)}</span>
                </div>
              )}
              {breakdown.pickupFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-theme-text-muted">Ritiro a domicilio</span>
                  <span className="font-mono text-theme-text-primary">€{breakdown.pickupFee.toFixed(2)}</span>
                </div>
              )}
              <div className="border-t border-dr7-gold/30 pt-2 mt-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-dr7-gold text-base">TOTALE</span>
                  <span className="font-mono text-2xl font-bold text-dr7-gold">€{breakdown.total.toFixed(2)}</span>
                </div>
              </div>
              {parseFloat(form.deposit_amount) > 0 && (
                <div className="flex justify-between text-theme-text-muted">
                  <span>Cauzione</span>
                  <span className="font-mono">€{parseFloat(form.deposit_amount).toFixed(2)}</span>
                </div>
              )}
              {!form.unlimited_km && parseInt(form.km_limit) > 0 && (
                <div className="flex justify-between text-theme-text-muted">
                  <span>Limite KM: {form.km_limit} km • Sforo: €{form.km_overage_fee}/km</span>
                </div>
              )}
            </div>

            {/* Manual total override */}
            <div className="mt-4 pt-3 border-t border-theme-border/30">
              <Input label="Totale Manuale (€) — Modifica se necessario" type="number" step="0.01"
                value={form.total_amount}
                onChange={(e) => setForm(prev => ({ ...prev, total_amount: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-theme-border">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvataggio...' : 'Salva Preventivo'}
          </Button>
          <Button variant="secondary" onClick={onClose}>Annulla</Button>
        </div>
      </div>
    </div>
  )
}
