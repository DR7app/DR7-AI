import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface Preventivo {
  id: string
  vehicle_id?: string
  vehicle_name?: string
  vehicle_plate?: string
  vehicle_category?: string
  vehicle_model_year?: number
  vehicle_cv?: number
  vehicle_0_100?: number
  pickup_date?: string
  dropoff_date?: string
  rental_days?: number
  base_daily_rate?: number
  maggiorazione_pct?: number
  daily_rate_after_markup?: number
  insurance_option?: string
  insurance_daily_price?: number
  insurance_total?: number
  lavaggio_fee?: number
  no_cauzione_daily?: number
  no_cauzione_total?: number
  unlimited_km_daily?: number
  unlimited_km_total?: number
  second_driver_daily?: number
  second_driver_total?: number
  subtotal?: number
  sconto?: number
  sconto_note?: string
  total_final?: number
  pricing_trace?: Record<string, unknown>
  extras_detail?: Record<string, unknown>
  customer_phone?: string
  customer_name?: string | null
  driver_tier?: string
  status?: string
  motivo_rifiuto?: string | null
  motivo_rifiuto_note?: string | null
  booking_id?: string | null
  whatsapp_sent_at?: string | null
  whatsapp_message_id?: string | null
  created_by?: string
  created_at?: string
  updated_at?: string
  expires_at?: string | null
  events?: unknown[] | null
  // Legacy / cross-version fields
  daily_rate?: number
  delivery_address?: string
  pickup_location?: string
  delivery_enabled?: boolean
  pickup_enabled?: boolean
  delivery_fee?: number
  pickup_fee?: number
  notes?: string
  km_limit?: number
  sforo_km?: number
  second_driver?: boolean
  fascia?: string
  total_amount?: number
  valid_until?: string | null
  customer_id?: string | null
  [key: string]: unknown
}

// ===== BACKWARDS-COMPAT HELPERS =====
function getAmount(p: Preventivo): number {
  return (p.total_final ?? p.total_amount ?? p.subtotal ?? 0) as number
}

function getTier(p: Preventivo): string {
  return (p.driver_tier || p.fascia || '') as string
}

type Section = 'overview' | 'domanda' | 'conversione' | 'perdite' | 'azioni'

function formatCurrency(amount: number): string {
  return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDateShort(d: string | undefined | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
}

function getDayOfWeek(dateStr: string | undefined | null): number {
  if (!dateStr) return -1
  const d = new Date(dateStr)
  return d.getDay() // 0=Sun, 1=Mon...
}

function getWeekOfMonth(dateStr: string | undefined | null): number {
  if (!dateStr) return -1
  const d = new Date(dateStr)
  return Math.ceil(d.getDate() / 7)
}

// ===== STATUS HELPERS =====
function isActive(p: Preventivo): boolean {
  return p.status === 'bozza' || p.status === 'preventivo'
}
function isConverted(p: Preventivo): boolean {
  return p.status === 'accettato' || p.status === 'convertito'
}
function isExpired(p: Preventivo): boolean {
  return p.status === 'scaduto'
}
function isRifiutato(p: Preventivo): boolean {
  return p.status === 'rifiutato'
}

// ===== PRICE RANGE FILTER =====
const PRICE_RANGE_OPTIONS = [
  { label: 'Tutte le fasce', value: '' },
  { label: '0-100€', value: '0-100', min: 0, max: 100 },
  { label: '100-300€', value: '100-300', min: 100, max: 300 },
  { label: '300-500€', value: '300-500', min: 300, max: 500 },
  { label: '500-1000€', value: '500-1000', min: 500, max: 1000 },
  { label: '1000€+', value: '1000+', min: 1000, max: Infinity },
]

const DURATION_OPTIONS = [
  { label: 'Tutte le durate', value: '' },
  { label: '1 giorno', value: '1g', min: 1, max: 1 },
  { label: '2-3 giorni', value: '2-3g', min: 2, max: 3 },
  { label: '4-7 giorni', value: '4-7g', min: 4, max: 7 },
  { label: '7+ giorni', value: '7g+', min: 8, max: Infinity },
]

// ===== TREND COMPONENT =====
function Trend({ current, previous, format = 'number' }: { current: number; previous: number; format?: 'number' | 'currency' | 'percent' }) {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return <span className="text-green-400 text-xs font-semibold ml-1">Nuovo</span>

  const delta = current - previous
  const pct = Math.abs((delta / previous) * 100)
  const isUp = delta >= 0
  const color = isUp ? 'text-green-400' : 'text-red-400'
  const arrow = isUp ? '↑' : '↓'

  let label = ''
  if (format === 'currency') label = formatCurrency(Math.abs(delta))
  else if (format === 'percent') label = `${Math.abs(delta).toFixed(1)}pp`
  else label = `${pct.toFixed(0)}%`

  return (
    <span className={`text-xs font-semibold ml-1 ${color}`}>
      {arrow}{label}
    </span>
  )
}

export default function ReportPreventiviTab() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preventivi, setPreventivi] = useState<Preventivo[]>([])
  const [prevMonthData, setPrevMonthData] = useState<Preventivo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [activeSection, setActiveSection] = useState<Section>('overview')
  // Filters
  const [filterVehicle, setFilterVehicle] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterFascia, setFilterFascia] = useState('')
  const [filterPriceRange, setFilterPriceRange] = useState('')
  const [filterDuration, setFilterDuration] = useState('')

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const [year, month] = selectedMonth.split('-').map(Number)
      const startDate = new Date(year, month - 1, 1).toISOString()
      const endDate = new Date(year, month, 0, 23, 59, 59).toISOString()

      // Previous month range
      const prevYear = month === 1 ? year - 1 : year
      const prevMonth = month === 1 ? 12 : month - 1
      const prevStartDate = new Date(prevYear, prevMonth - 1, 1).toISOString()
      const prevEndDate = new Date(prevYear, prevMonth, 0, 23, 59, 59).toISOString()

      const [{ data, error: dbError }, { data: prevData, error: prevDbError }] = await Promise.all([
        supabase
          .from('preventivi')
          .select('*')
          .gte('created_at', startDate)
          .lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        supabase
          .from('preventivi')
          .select('id, status, motivo_rifiuto, motivo_rifiuto_note, total_final, total_amount, subtotal, whatsapp_sent_at, customer_name, customer_id, created_at, created_by')
          .gte('created_at', prevStartDate)
          .lte('created_at', prevEndDate),
      ])

      if (dbError) throw new Error(dbError.message)
      if (prevDbError) throw new Error(prevDbError.message)

      // 2026-05-23: escludiamo preventivi creati dall'account TEST
      // (ophe@dr7.app) cosi' i numeri del report (conversion rate,
      // totale, valore medio) non sono falsati dalle prove direzione.
      // Filtro JS-side per evitare la sintassi PostgREST `.or().not.in()`
      // che fa errori difficili da debuggare. Aggiungere altre email
      // di test all'array se ne nascono.
      const TEST_CREATOR_EMAILS = new Set(['ophe@dr7.app'])
      const isNotTest = (p: { created_by?: string | null }) =>
        !p.created_by || !TEST_CREATOR_EMAILS.has(String(p.created_by).toLowerCase().trim())
      setPreventivi((data || []).filter(isNotTest))
      setPrevMonthData((prevData || []).filter(isNotTest))
      setLoaded(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  // Reset loaded state when month changes
  useEffect(() => {
    setLoaded(false)
    setPreventivi([])
    setPrevMonthData([])
  }, [selectedMonth])

  // ===== FILTERED DATA =====
  const filtered = useMemo(() => {
    return preventivi.filter(p => {
      if (filterVehicle && !p.vehicle_name?.toLowerCase().includes(filterVehicle.toLowerCase())) return false
      if (filterCategory && p.vehicle_category !== filterCategory) return false
      if (filterFascia && getTier(p) !== filterFascia) return false
      if (filterPriceRange) {
        const opt = PRICE_RANGE_OPTIONS.find(o => o.value === filterPriceRange)
        if (opt && 'min' in opt) {
          const amt = getAmount(p)
          if (amt < (opt.min ?? 0) || amt >= (opt.max ?? Infinity)) return false
        }
      }
      if (filterDuration) {
        const opt = DURATION_OPTIONS.find(o => o.value === filterDuration)
        if (opt && 'min' in opt) {
          const days = p.rental_days || 1
          if (days < (opt.min ?? 0) || days > (opt.max ?? Infinity)) return false
        }
      }
      return true
    })
  }, [preventivi, filterVehicle, filterCategory, filterFascia, filterPriceRange, filterDuration])

  const hasActiveFilters = !!(filterVehicle || filterCategory || filterFascia || filterPriceRange || filterDuration)

  function clearFilters() {
    setFilterVehicle('')
    setFilterCategory('')
    setFilterFascia('')
    setFilterPriceRange('')
    setFilterDuration('')
  }

  // ===== OVERVIEW METRICS =====
  const overview = useMemo(() => {
    const total = filtered.length
    const active = filtered.filter(isActive).length
    const converted = filtered.filter(isConverted).length
    const expired = filtered.filter(isExpired).length
    const rifiutati = filtered.filter(isRifiutato)
    const rifiutatiCount = rifiutati.length
    const rifiutatiValue = rifiutati.reduce((s, p) => s + getAmount(p), 0)
    const rifiutatiByMotivo: Record<string, number> = { cauzione: 0, prezzo: 0, non_specificato: 0 }
    for (const p of rifiutati) {
      const m = (p.motivo_rifiuto || '').toLowerCase()
      if (m === 'cauzione') rifiutatiByMotivo.cauzione++
      else if (m === 'prezzo') rifiutatiByMotivo.prezzo++
      else rifiutatiByMotivo.non_specificato++
    }
    const totalValue = filtered.reduce((s, p) => s + getAmount(p), 0)
    const convertedValue = filtered.filter(isConverted).reduce((s, p) => s + getAmount(p), 0)
    const lostValue = filtered.filter(p => !isConverted(p)).reduce((s, p) => s + getAmount(p), 0)
    const conversionRate = total > 0 ? (converted / total) * 100 : 0
    const withCustomer = filtered.filter(p => p.customer_id || p.customer_name).length
    const withDelivery = filtered.filter(p => p.delivery_enabled).length

    // Previous month metrics (no filter applied — raw totals)
    const prevTotal = prevMonthData.length
    const prevConverted = prevMonthData.filter(isConverted).length
    const prevRifiutati = prevMonthData.filter(isRifiutato).length
    const prevConversionRate = prevTotal > 0 ? (prevConverted / prevTotal) * 100 : 0
    const prevTotalValue = prevMonthData.reduce((s, p) => s + getAmount(p), 0)

    return {
      total, active, converted, expired,
      rifiutatiCount, rifiutatiValue, rifiutatiByMotivo,
      totalValue, convertedValue, lostValue, conversionRate,
      withCustomer, withDelivery,
      prevTotal, prevConverted, prevRifiutati, prevConversionRate, prevTotalValue,
    }
  }, [filtered, prevMonthData])

  // ===== DOMANDA (DEMAND) METRICS =====
  const domanda = useMemo(() => {
    // Top vehicles by request count
    const vehicleMap = new Map<string, { count: number; value: number; converted: number }>()
    filtered.forEach(p => {
      const key = p.vehicle_name || 'N/A'
      const entry = vehicleMap.get(key) || { count: 0, value: 0, converted: 0 }
      entry.count++
      entry.value += getAmount(p)
      if (isConverted(p)) entry.converted++
      vehicleMap.set(key, entry)
    })
    const topVehicles = Array.from(vehicleMap.entries())
      .map(([name, data]) => ({ name, ...data, conversionRate: data.count > 0 ? (data.converted / data.count) * 100 : 0 }))
      .sort((a, b) => b.count - a.count)

    // By category
    const categoryMap = new Map<string, { count: number; value: number; converted: number }>()
    filtered.forEach(p => {
      const key = p.vehicle_category || 'N/A'
      const entry = categoryMap.get(key) || { count: 0, value: 0, converted: 0 }
      entry.count++
      entry.value += getAmount(p)
      if (isConverted(p)) entry.converted++
      categoryMap.set(key, entry)
    })
    const byCategory = Array.from(categoryMap.entries())
      .map(([name, data]) => ({ name, ...data, conversionRate: data.count > 0 ? (data.converted / data.count) * 100 : 0 }))
      .sort((a, b) => b.count - a.count)

    // By rental duration
    const durationBuckets: Record<string, number> = { '1g': 0, '2-3g': 0, '4-7g': 0, '7g+': 0 }
    filtered.forEach(p => {
      const d = p.rental_days || 1
      if (d === 1) durationBuckets['1g']++
      else if (d <= 3) durationBuckets['2-3g']++
      else if (d <= 7) durationBuckets['4-7g']++
      else durationBuckets['7g+']++
    })
    const byDuration = Object.entries(durationBuckets).map(([range, count]) => ({ range, count }))

    // Top combos (vehicle + duration + delivery)
    const comboMap = new Map<string, number>()
    filtered.forEach(p => {
      const dur = (p.rental_days || 1) <= 2 ? 'weekend' : (p.rental_days || 1) <= 7 ? 'settimana' : 'lungo'
      const del = p.delivery_enabled ? 'domicilio' : 'sede'
      const key = `${p.vehicle_name || 'N/A'} + ${dur} + ${del}`
      comboMap.set(key, (comboMap.get(key) || 0) + 1)
    })
    const topCombos = Array.from(comboMap.entries())
      .map(([combo, count]) => ({ combo, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // By day of week (pickup_date)
    const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
    const dowCounts: number[] = [0, 0, 0, 0, 0, 0, 0]
    filtered.forEach(p => {
      const dow = getDayOfWeek(p.pickup_date)
      if (dow >= 0) dowCounts[dow]++
    })
    const byDayOfWeek = DOW_LABELS.map((label, i) => ({ label, count: dowCounts[i] }))

    // By week of month (pickup_date)
    const wom: Record<string, number> = { 'Sett 1': 0, 'Sett 2': 0, 'Sett 3': 0, 'Sett 4': 0 }
    filtered.forEach(p => {
      const w = getWeekOfMonth(p.pickup_date)
      if (w >= 1 && w <= 4) wom[`Sett ${w}`]++
    })
    const byWeekOfMonth = Object.entries(wom).map(([label, count]) => ({ label, count }))

    return { topVehicles, byCategory, byDuration, topCombos, byDayOfWeek, byWeekOfMonth }
  }, [filtered])

  // ===== CONVERSIONE METRICS =====
  const conversione = useMemo(() => {
    // Funnel phases
    const total = filtered.length
    const sent = filtered.filter(p => p.whatsapp_sent_at != null).length
    const withClient = filtered.filter(p => p.customer_name || p.customer_id).length
    const converted = filtered.filter(isConverted).length

    // By price range
    const priceRanges = [
      { label: '0-100€', min: 0, max: 100 },
      { label: '100-300€', min: 100, max: 300 },
      { label: '300-500€', min: 300, max: 500 },
      { label: '500-1000€', min: 500, max: 1000 },
      { label: '1000€+', min: 1000, max: Infinity },
    ]
    const byPrice = priceRanges.map(r => {
      const inRange = filtered.filter(p => getAmount(p) >= r.min && getAmount(p) < r.max)
      const conv = inRange.filter(isConverted).length
      return { label: r.label, total: inRange.length, converted: conv, rate: inRange.length > 0 ? (conv / inRange.length) * 100 : 0 }
    }).filter(r => r.total > 0)

    // By tier (fascia)
    const byFascia = ['A', 'B'].map(f => {
      const inFascia = filtered.filter(p => getTier(p) === f)
      const conv = inFascia.filter(isConverted).length
      return { fascia: f, total: inFascia.length, converted: conv, rate: inFascia.length > 0 ? (conv / inFascia.length) * 100 : 0 }
    }).filter(r => r.total > 0)

    // By insurance
    const insuranceMap = new Map<string, { total: number; converted: number }>()
    filtered.forEach(p => {
      const key = p.insurance_option || 'N/A'
      const entry = insuranceMap.get(key) || { total: 0, converted: 0 }
      entry.total++
      if (isConverted(p)) entry.converted++
      insuranceMap.set(key, entry)
    })
    const byInsurance = Array.from(insuranceMap.entries())
      .map(([option, data]) => ({ option, ...data, rate: data.total > 0 ? (data.converted / data.total) * 100 : 0 }))
      .sort((a, b) => b.total - a.total)

    return { funnel: { total, sent, withClient, converted }, byPrice, byFascia, byInsurance }
  }, [filtered])

  // ===== PERDITE (LOSSES) =====
  const perdite = useMemo(() => {
    const nonConverted = filtered.filter(p => !isConverted(p))

    // Group lost by vehicle
    const lostByVehicle = new Map<string, { count: number; value: number }>()
    nonConverted.forEach(p => {
      const key = p.vehicle_name || 'N/A'
      const entry = lostByVehicle.get(key) || { count: 0, value: 0 }
      entry.count++
      entry.value += getAmount(p)
      lostByVehicle.set(key, entry)
    })
    const topLost = Array.from(lostByVehicle.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)

    // Status breakdown of non-converted
    const stillActive = nonConverted.filter(isActive).length
    const expired = nonConverted.filter(isExpired).length
    const noCustomer = nonConverted.filter(p => !p.customer_id && !p.customer_name).length
    const withCustomerNotConverted = nonConverted.filter(p => p.customer_id || p.customer_name).length

    // Top non-converted preventivi by value
    const topByValue = [...nonConverted]
      .sort((a, b) => getAmount(b) - getAmount(a))
      .slice(0, 15)

    // Periodo passato vs attivo
    const nowTs = Date.now()
    const periodoPast = nonConverted.filter(p => p.dropoff_date && new Date(p.dropoff_date).getTime() < nowTs).length
    const periodoActive = nonConverted.filter(p => p.dropoff_date && new Date(p.dropoff_date).getTime() >= nowTs).length
    const periodoNoDate = nonConverted.length - periodoPast - periodoActive

    // Average and stddev for amount
    const allAmounts = filtered.map(getAmount)
    const avg = allAmounts.length > 0 ? allAmounts.reduce((s, v) => s + v, 0) / allAmounts.length : 0
    const variance = allAmounts.length > 0 ? allAmounts.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / allAmounts.length : 0
    const stddev = Math.sqrt(variance)

    // Motivo stimato abbandono — for rejected preventivi we trust the explicit
    // motivo_rifiuto column the operator picked at rejection time; for the
    // others we fall back to heuristics on whatsapp/customer/status.
    const motivoCounts: Record<string, number> = {
      'Rifiutato — Cauzione': 0,
      'Rifiutato — Prezzo': 0,
      'Rifiutato (motivo non specificato)': 0,
      'Preventivo mai inviato al cliente': 0,
      'Cliente non ha risposto': 0,
      'Prezzo superiore alla media': 0,
      'Nessun follow-up possibile': 0,
    }
    nonConverted.forEach(p => {
      if (isRifiutato(p)) {
        const motivo = (p.motivo_rifiuto || '').toLowerCase()
        if (motivo === 'cauzione') motivoCounts['Rifiutato — Cauzione']++
        else if (motivo === 'prezzo') motivoCounts['Rifiutato — Prezzo']++
        else motivoCounts['Rifiutato (motivo non specificato)']++
      } else if (p.status === 'bozza' && !p.whatsapp_sent_at) {
        motivoCounts['Preventivo mai inviato al cliente']++
      } else if (isExpired(p) && p.whatsapp_sent_at) {
        motivoCounts['Cliente non ha risposto']++
      } else if (getAmount(p) > avg + stddev && getAmount(p) > 0) {
        motivoCounts['Prezzo superiore alla media']++
      } else if (!p.customer_name && !p.customer_id && p.status !== 'bozza') {
        motivoCounts['Nessun follow-up possibile']++
      }
    })
    const motivoList = Object.entries(motivoCounts)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)

    return {
      nonConverted, topLost, stillActive, expired, noCustomer,
      withCustomerNotConverted, topByValue,
      periodoPast, periodoActive, periodoNoDate,
      motivoList,
    }
  }, [filtered])

  // ===== AZIONI SUGGERITE =====
  const azioni = useMemo(() => {
    const suggestions: { icon: string; title: string; detail: string; metric: string; priority: 'alta' | 'media' | 'bassa' }[] = []

    // High demand low conversion vehicles
    domanda.topVehicles.forEach(v => {
      if (v.count >= 3 && v.conversionRate < 20) {
        suggestions.push({
          icon: '⚠️',
          title: `${v.name}: alta richiesta, bassa conversione`,
          detail: `${v.count} preventivi, solo ${v.converted} convertiti. Verifica pricing o condizioni.`,
          metric: `${v.conversionRate.toFixed(0)}% conv.`,
          priority: 'alta',
        })
      }
    })

    // Funnel drop: inviato → convertito
    const { funnel } = conversione
    if (funnel.sent >= 3) {
      const sentToConvRate = (funnel.converted / funnel.sent) * 100
      if (sentToConvRate < 30) {
        suggestions.push({
          icon: '📉',
          title: `Solo ${sentToConvRate.toFixed(0)}% dei preventivi inviati viene convertito`,
          detail: `${funnel.sent} inviati, ${funnel.converted} convertiti. Valuta follow-up o promozioni.`,
          metric: `${funnel.converted}/${funnel.sent} inviati`,
          priority: 'alta',
        })
      }
    }

    // Many never-sent preventivi
    const neverSent = filtered.filter(p => p.status === 'bozza' && !p.whatsapp_sent_at).length
    if (neverSent >= 3) {
      suggestions.push({
        icon: '📤',
        title: `${neverSent} preventivi in bozza mai inviati al cliente`,
        detail: `Verifica se sono da completare o eliminare. I preventivi non inviati non possono convertirsi.`,
        metric: `${neverSent} bozze`,
        priority: 'alta',
      })
    }

    // High delivery drop-off
    const deliveryPrev = filtered.filter(p => p.delivery_enabled)
    const deliveryConv = deliveryPrev.filter(isConverted).length
    if (deliveryPrev.length >= 3) {
      const deliveryRate = (deliveryConv / deliveryPrev.length) * 100
      const noDeliveryPrev = filtered.filter(p => !p.delivery_enabled)
      const noDeliveryRate = noDeliveryPrev.length > 0 ? (noDeliveryPrev.filter(isConverted).length / noDeliveryPrev.length) * 100 : 0
      if (deliveryRate < noDeliveryRate - 10) {
        suggestions.push({
          icon: '🚗',
          title: `Preventivi con consegna domicilio convertono meno`,
          detail: `${deliveryPrev.length} preventivi con consegna domicilio. Rivedere costo consegna.`,
          metric: `${deliveryRate.toFixed(0)}% vs ${noDeliveryRate.toFixed(0)}%`,
          priority: 'media',
        })
      }
    }

    // Lost value alert
    if (overview.lostValue > 5000) {
      suggestions.push({
        icon: '💰',
        title: `Valore potenziale perso elevato`,
        detail: `${perdite.nonConverted.length} preventivi non convertiti. ${perdite.noCustomer} senza cliente assegnato.`,
        metric: formatCurrency(overview.lostValue),
        priority: 'alta',
      })
    }

    // No customer assigned
    if (perdite.noCustomer > 3) {
      suggestions.push({
        icon: '👤',
        title: `${perdite.noCustomer} preventivi senza cliente assegnato`,
        detail: `Assegna un cliente per poter inviare il preventivo e aumentare le conversioni.`,
        metric: `${perdite.noCustomer} senza cliente`,
        priority: 'media',
      })
    }

    // High price = low conversion
    const highPriceBucket = conversione.byPrice.find(b => b.label === '1000€+' || b.label === '500-1000€')
    if (highPriceBucket && highPriceBucket.total >= 3 && highPriceBucket.rate < 15) {
      suggestions.push({
        icon: '📊',
        title: `Fascia prezzo ${highPriceBucket.label}: conversione bassa`,
        detail: `${highPriceBucket.total} preventivi, solo ${highPriceBucket.converted} convertiti. Valuta sconti o promozioni.`,
        metric: `${highPriceBucket.rate.toFixed(0)}% conv.`,
        priority: 'media',
      })
    }

    // High demand period
    const maxDow = domanda.byDayOfWeek.reduce((a, b) => (b.count > a.count ? b : a), { label: '', count: 0 })
    if (maxDow.count >= 3) {
      suggestions.push({
        icon: '📅',
        title: `Alta richiesta il ${maxDow.label}`,
        detail: `Il giorno con più richieste è ${maxDow.label} (${maxDow.count} preventivi). Assicura disponibilità veicoli.`,
        metric: `${maxDow.count} richieste`,
        priority: 'bassa',
      })
    }

    // Expired preventivi
    if (perdite.expired > 2) {
      suggestions.push({
        icon: '⏳',
        title: `${perdite.expired} preventivi scaduti`,
        detail: `Valuta di estendere la validità o contattare i clienti prima della scadenza.`,
        metric: `${perdite.expired} scaduti`,
        priority: 'bassa',
      })
    }

    // Sort by priority
    const priorityOrder: Record<string, number> = { alta: 0, media: 1, bassa: 2 }
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    return suggestions
  }, [domanda, overview, perdite, conversione, filtered])

  const sections: { key: Section; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'domanda', label: 'Domanda' },
    { key: 'conversione', label: 'Conversione' },
    { key: 'perdite', label: 'Perdite' },
    { key: 'azioni', label: 'Azioni Suggerite' },
  ]

  const categories = [...new Set(preventivi.map(p => p.vehicle_category).filter(Boolean))] as string[]

  return (
    <div className="space-y-6">
      {/* Header */}
      <h2 className="text-2xl font-bold text-theme-text-primary">Report Preventivi</h2>

      {/* Controls */}
      <div className="bg-theme-bg-secondary/50 backdrop-blur-sm rounded-xl border border-theme-border p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Mese</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
            />
          </div>
          <button
            onClick={fetchReport}
            disabled={loading}
            className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors disabled:opacity-50"
          >
            {loading ? 'Caricamento...' : 'Genera Report'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {loaded && preventivi.length > 0 && (
        <>
          {/* Section Tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-theme-border pb-1">
            {sections.map(s => (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors rounded-t-lg ${
                  activeSection === s.key
                    ? 'text-dr7-gold border-b-2 border-dr7-gold bg-dr7-gold/10'
                    : 'text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                {s.label}
                {s.key === 'azioni' && azioni.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-red-500/20 text-red-400 font-bold">{azioni.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="Filtra veicolo..."
              value={filterVehicle}
              onChange={(e) => setFilterVehicle(e.target.value)}
              className="px-3 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary placeholder-theme-text-muted"
            />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
            >
              <option value="">Tutte le categorie</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={filterFascia}
              onChange={(e) => setFilterFascia(e.target.value)}
              className="px-3 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
            >
              <option value="">Tutte le fasce</option>
              <option value="A">Fascia A</option>
              <option value="B">Fascia B</option>
            </select>
            <select
              value={filterPriceRange}
              onChange={(e) => setFilterPriceRange(e.target.value)}
              className="px-3 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
            >
              {PRICE_RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={filterDuration}
              onChange={(e) => setFilterDuration(e.target.value)}
              className="px-3 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
            >
              {DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300"
              >
                Rimuovi filtri
              </button>
            )}
          </div>

          {/* ===== OVERVIEW ===== */}
          {activeSection === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <StatCard
                  label="Preventivi Totali"
                  value={overview.total}
                  trend={<Trend current={overview.total} previous={overview.prevTotal} />}
                />
                <StatCard label="Attivi" value={overview.active} color="text-blue-400" />
                <StatCard
                  label="Accettati"
                  value={overview.converted}
                  color="text-green-400"
                  trend={<Trend current={overview.converted} previous={overview.prevConverted} />}
                />
                <StatCard
                  label="Rifiutati"
                  value={overview.rifiutatiCount}
                  color="text-red-400"
                  trend={<Trend current={overview.rifiutatiCount} previous={overview.prevRifiutati} />}
                />
                <StatCard label="Scaduti" value={overview.expired} color="text-amber-400" />
                <StatCard
                  label="Conversion Rate"
                  value={`${overview.conversionRate.toFixed(1)}%`}
                  color="text-dr7-gold"
                  trend={<Trend current={overview.conversionRate} previous={overview.prevConversionRate} format="percent" />}
                />
              </div>

              {/* Rifiutati breakdown by motivo */}
              {overview.rifiutatiCount > 0 && (
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-4">
                  <p className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Motivo dei rifiuti</p>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                      <p className="text-red-300 font-semibold">Cauzione</p>
                      <p className="text-2xl font-bold text-red-400">{overview.rifiutatiByMotivo.cauzione}</p>
                      <p className="text-xs text-theme-text-muted mt-1">
                        {overview.rifiutatiCount > 0 ? `${((overview.rifiutatiByMotivo.cauzione / overview.rifiutatiCount) * 100).toFixed(0)}% dei rifiuti` : ''}
                      </p>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                      <p className="text-red-300 font-semibold">Prezzo</p>
                      <p className="text-2xl font-bold text-red-400">{overview.rifiutatiByMotivo.prezzo}</p>
                      <p className="text-xs text-theme-text-muted mt-1">
                        {overview.rifiutatiCount > 0 ? `${((overview.rifiutatiByMotivo.prezzo / overview.rifiutatiCount) * 100).toFixed(0)}% dei rifiuti` : ''}
                      </p>
                    </div>
                    <div className="bg-theme-bg-tertiary/50 border border-theme-border rounded p-3">
                      <p className="text-theme-text-secondary font-semibold">Senza motivo</p>
                      <p className="text-2xl font-bold text-theme-text-muted">{overview.rifiutatiByMotivo.non_specificato}</p>
                      <p className="text-xs text-theme-text-muted mt-1">Storici prima del tracciamento</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard
                  label="Valore Totale"
                  value={formatCurrency(overview.totalValue)}
                  color="text-theme-text-primary"
                  trend={<Trend current={overview.totalValue} previous={overview.prevTotalValue} format="currency" />}
                />
                <StatCard label="Valore Convertito" value={formatCurrency(overview.convertedValue)} color="text-green-400" />
                <StatCard label="Valore Potenziale Perso" value={formatCurrency(overview.lostValue)} color="text-red-400" highlight />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Con Cliente Assegnato" value={overview.withCustomer} />
                <StatCard label="Con Consegna Domicilio" value={overview.withDelivery} />
              </div>
            </div>
          )}

          {/* ===== DOMANDA ===== */}
          {activeSection === 'domanda' && (
            <div className="space-y-6">
              <ReportTable
                title="Top Veicoli per Preventivi"
                headers={['Veicolo', 'Richieste', 'Valore', 'Conv.', 'Rate']}
                rows={domanda.topVehicles.map(v => [
                  v.name,
                  String(v.count),
                  formatCurrency(v.value),
                  String(v.converted),
                  `${v.conversionRate.toFixed(0)}%`
                ])}
              />

              <ReportTable
                title="Per Categoria"
                headers={['Categoria', 'Richieste', 'Valore', 'Conv.', 'Rate']}
                rows={domanda.byCategory.map(c => [
                  c.name,
                  String(c.count),
                  formatCurrency(c.value),
                  String(c.converted),
                  `${c.conversionRate.toFixed(0)}%`
                ])}
              />

              <ReportTable
                title="Per Durata Noleggio"
                headers={['Durata', 'Richieste']}
                rows={domanda.byDuration.filter(d => d.count > 0).map(d => [d.range, String(d.count)])}
              />

              {/* Top Periodi Richiesti — Day of week */}
              <ReportTable
                title="Top Periodi Richiesti — Giorno della Settimana (pickup)"
                headers={['Giorno', 'Richieste']}
                rows={domanda.byDayOfWeek.filter(d => d.count > 0).map(d => [d.label, String(d.count)])}
              />

              {/* Top Periodi Richiesti — Week of month */}
              <ReportTable
                title="Top Periodi Richiesti — Settimana del Mese (pickup)"
                headers={['Settimana', 'Richieste']}
                rows={domanda.byWeekOfMonth.filter(d => d.count > 0).map(d => [d.label, String(d.count)])}
              />

              {domanda.topCombos.length > 0 && (
                <ReportTable
                  title="Top Combinazioni Richieste"
                  headers={['Combinazione', 'Richieste']}
                  rows={domanda.topCombos.map(c => [c.combo, String(c.count)])}
                />
              )}
            </div>
          )}

          {/* ===== CONVERSIONE ===== */}
          {activeSection === 'conversione' && (
            <div className="space-y-6">
              {/* Funnel visualization */}
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
                <h3 className="text-sm font-semibold text-theme-text-primary mb-4">Funnel di Conversione</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Creato', count: conversione.funnel.total, color: 'from-dr7-gold to-[#2a8a7e]' },
                    { label: 'Inviato (WhatsApp)', count: conversione.funnel.sent, color: 'from-[#2a8a7e] to-[#1f6b61]' },
                    { label: 'Con Cliente', count: conversione.funnel.withClient, color: 'from-[#1f6b61] to-[#155249]' },
                    { label: 'Convertito', count: conversione.funnel.converted, color: 'from-green-600 to-green-800' },
                  ].map((phase, i) => {
                    const pct = conversione.funnel.total > 0
                      ? Math.round((phase.count / conversione.funnel.total) * 100)
                      : 0
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-28 text-right text-xs text-theme-text-muted shrink-0">{phase.label}</div>
                        <div className="flex-1 bg-theme-bg-primary/50 rounded-full h-7 overflow-hidden">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${phase.color} flex items-center justify-end pr-2 transition-all duration-500`}
                            style={{ width: `${Math.max(pct, 2)}%` }}
                          >
                            <span className="text-white text-xs font-bold whitespace-nowrap">{pct}%</span>
                          </div>
                        </div>
                        <div className="w-10 text-xs text-theme-text-muted shrink-0">{phase.count}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <ReportTable
                title="Conversione per Veicolo"
                headers={['Veicolo', 'Richieste', 'Convertiti', 'Rate']}
                rows={domanda.topVehicles.map(v => [
                  v.name,
                  String(v.count),
                  String(v.converted),
                  `${v.conversionRate.toFixed(0)}%`
                ])}
                highlightLowRate
              />

              <ReportTable
                title="Conversione per Fascia Prezzo"
                headers={['Fascia', 'Totale', 'Convertiti', 'Rate']}
                rows={conversione.byPrice.map(b => [
                  b.label,
                  String(b.total),
                  String(b.converted),
                  `${b.rate.toFixed(0)}%`
                ])}
                highlightLowRate
              />

              {conversione.byFascia.length > 0 && (
                <ReportTable
                  title="Conversione per Fascia Cliente"
                  headers={['Fascia', 'Totale', 'Convertiti', 'Rate']}
                  rows={conversione.byFascia.map(f => [
                    `Fascia ${f.fascia}`,
                    String(f.total),
                    String(f.converted),
                    `${f.rate.toFixed(0)}%`
                  ])}
                />
              )}

              <ReportTable
                title="Conversione per Assicurazione"
                headers={['Assicurazione', 'Totale', 'Convertiti', 'Rate']}
                rows={conversione.byInsurance.map(i => [
                  i.option,
                  String(i.total),
                  String(i.converted),
                  `${i.rate.toFixed(0)}%`
                ])}
              />
            </div>
          )}

          {/* ===== PERDITE ===== */}
          {activeSection === 'perdite' && (
            <div className="space-y-6">
              {/* Loss summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Non Convertiti" value={perdite.nonConverted.length} color="text-red-400" />
                <StatCard label="Ancora Attivi" value={perdite.stillActive} color="text-blue-400" />
                <StatCard label="Scaduti" value={perdite.expired} color="text-orange-400" />
                <StatCard label="Senza Cliente" value={perdite.noCustomer} color="text-purple-400" />
              </div>

              {/* Motivo Stimato Abbandono */}
              {perdite.motivoList.length > 0 && (
                <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
                  <h3 className="text-sm font-semibold text-theme-text-primary mb-4">Motivo Stimato Abbandono</h3>
                  <div className="space-y-3">
                    {(() => {
                      const maxCount = Math.max(...perdite.motivoList.map(([, c]) => c), 1)
                      return perdite.motivoList.map(([motivo, count]) => {
                        const pct = Math.round((count / maxCount) * 100)
                        return (
                          <div key={motivo} className="flex items-center gap-3">
                            <div className="w-52 text-right text-xs text-theme-text-muted shrink-0 hidden md:block">{motivo}</div>
                            <div className="flex-1">
                              <p className="text-xs text-theme-text-muted mb-1 md:hidden">{motivo}</p>
                              <div className="bg-theme-bg-primary/50 rounded-full h-5 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-800 flex items-center justify-end pr-2"
                                  style={{ width: `${Math.max(pct, 4)}%` }}
                                >
                                  <span className="text-white text-[10px] font-bold">{count}</span>
                                </div>
                              </div>
                            </div>
                            <div className="w-8 text-xs text-theme-text-muted shrink-0">{count}</div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>
              )}

              {/* Stato Attuale Non-Convertiti — periodo */}
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
                <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Stato Periodo Non-Convertiti</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-theme-bg-tertiary/40 p-3 text-center">
                    <p className="text-2xl font-bold text-orange-400">{perdite.periodoPast}</p>
                    <p className="text-xs text-theme-text-muted mt-1">Periodo passato</p>
                  </div>
                  <div className="rounded-lg bg-theme-bg-tertiary/40 p-3 text-center">
                    <p className="text-2xl font-bold text-blue-400">{perdite.periodoActive}</p>
                    <p className="text-xs text-theme-text-muted mt-1">Ancora attivo</p>
                  </div>
                  <div className="rounded-lg bg-theme-bg-tertiary/40 p-3 text-center">
                    <p className="text-2xl font-bold text-gray-400">{perdite.periodoNoDate}</p>
                    <p className="text-xs text-theme-text-muted mt-1">Senza data</p>
                  </div>
                </div>
              </div>

              {/* Top lost by vehicle */}
              <ReportTable
                title="Perdite per Veicolo (Top 10)"
                headers={['Veicolo', 'Preventivi Persi', 'Valore Perso']}
                rows={perdite.topLost.map(v => [
                  v.name,
                  String(v.count),
                  formatCurrency(v.value)
                ])}
              />

              {/* Top non-converted by value */}
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
                <div className="px-4 py-3 border-b border-theme-border">
                  <h3 className="text-sm font-semibold text-theme-text-primary">Preventivi Non Convertiti (Top per Valore)</h3>
                </div>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                        <th className="text-left px-4 py-3">Veicolo</th>
                        <th className="text-left px-4 py-3">Periodo</th>
                        <th className="text-left px-4 py-3">Cliente</th>
                        <th className="text-center px-4 py-3">Stato</th>
                        <th className="text-right px-4 py-3">Valore</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perdite.topByValue.map(p => (
                        <tr key={p.id} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30">
                          <td className="px-4 py-3 font-medium text-theme-text-primary">{p.vehicle_name}</td>
                          <td className="px-4 py-3 text-theme-text-muted">
                            {formatDateShort(p.pickup_date)} → {formatDateShort(p.dropoff_date)}
                            {p.rental_days ? ` (${p.rental_days}g)` : ''}
                          </td>
                          <td className="px-4 py-3 text-theme-text-muted">
                            {p.customer_name || <span className="text-purple-400 text-xs">Non assegnato</span>}
                          </td>
                          <td className="text-center px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              isActive(p) ? 'bg-blue-500/20 text-blue-400' :
                              isExpired(p) ? 'bg-orange-500/20 text-orange-400' :
                              isRifiutato(p) ? 'bg-red-500/20 text-red-400' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>
                              {p.status || '-'}
                            </span>
                          </td>
                          <td className="text-right px-4 py-3 font-semibold text-red-400">{formatCurrency(getAmount(p))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile */}
                <div className="md:hidden p-3 space-y-2">
                  {perdite.topByValue.map(p => (
                    <div key={p.id} className="bg-theme-bg-tertiary/30 rounded-lg p-3 border border-theme-border">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-theme-text-primary text-sm">{p.vehicle_name}</p>
                          <p className="text-xs text-theme-text-muted">{formatDateShort(p.pickup_date)} → {formatDateShort(p.dropoff_date)}</p>
                          <p className="text-xs text-theme-text-muted">{p.customer_name || 'Non assegnato'}</p>
                        </div>
                        <p className="font-bold text-red-400">{formatCurrency(getAmount(p))}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ===== AZIONI SUGGERITE ===== */}
          {activeSection === 'azioni' && (
            <div className="space-y-3">
              {azioni.length === 0 ? (
                <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
                  <p className="text-theme-text-muted">Nessuna azione suggerita per questo periodo. Ottimo lavoro!</p>
                </div>
              ) : (
                azioni.map((a, i) => (
                  <div key={i} className={`rounded-xl border p-4 ${
                    a.priority === 'alta' ? 'border-red-500/40 bg-red-500/5' :
                    a.priority === 'media' ? 'border-orange-500/40 bg-orange-500/5' :
                    'border-theme-border bg-theme-bg-secondary/50'
                  }`}>
                    <div className="flex items-start gap-3">
                      <span className="text-xl">{a.icon}</span>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h4 className="font-semibold text-theme-text-primary text-sm">{a.title}</h4>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            a.priority === 'alta' ? 'bg-red-500/20 text-red-400' :
                            a.priority === 'media' ? 'bg-orange-500/20 text-orange-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>{a.priority}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-theme-bg-tertiary text-dr7-gold border border-dr7-gold/30">
                            {a.metric}
                          </span>
                        </div>
                        <p className="text-sm text-theme-text-muted">{a.detail}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {loaded && preventivi.length === 0 && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <p className="text-theme-text-muted text-lg mb-2">Nessun preventivo trovato per questo mese</p>
          <p className="text-theme-text-muted text-sm">Prova a selezionare un mese diverso</p>
        </div>
      )}

      {!loaded && !loading && !error && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-theme-text-muted text-lg mb-2">Seleziona un mese e genera il report</p>
          <p className="text-theme-text-muted text-sm">Analisi completa: overview, domanda, conversione, perdite e azioni suggerite</p>
        </div>
      )}
    </div>
  )
}

// ===== REUSABLE COMPONENTS =====

function StatCard({
  label,
  value,
  color,
  highlight,
  trend,
}: {
  label: string
  value: string | number
  color?: string
  highlight?: boolean
  trend?: React.ReactNode
}) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'border-red-500/40 bg-red-500/5' : 'border-theme-border bg-theme-bg-secondary/50'}`}>
      <p className="text-xs text-theme-text-muted">{label}</p>
      <p className={`text-2xl font-bold ${color || 'text-theme-text-primary'}`}>
        {value}
        {trend}
      </p>
    </div>
  )
}

function ReportTable({ title, headers, rows, highlightLowRate }: {
  title: string
  headers: string[]
  rows: string[][]
  highlightLowRate?: boolean
}) {
  if (rows.length === 0) return null

  return (
    <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
      <div className="px-4 py-3 border-b border-theme-border">
        <h3 className="text-sm font-semibold text-theme-text-primary">{title}</h3>
      </div>
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
              {headers.map((h, i) => (
                <th key={i} className={`px-4 py-3 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const lastCol = row[row.length - 1]
              const isLow = highlightLowRate && lastCol.endsWith('%') && parseFloat(lastCol) < 20
              return (
                <tr key={ri} className={`border-t border-theme-border hover:bg-theme-bg-tertiary/30 ${isLow ? 'bg-red-500/5' : ''}`}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-4 py-3 ${ci === 0 ? 'text-left font-medium text-theme-text-primary' : 'text-right'} ${
                      ci === row.length - 1 && cell.endsWith('%')
                        ? isLow ? 'text-red-400 font-semibold' : 'text-green-400 font-semibold'
                        : cell.startsWith('€') ? 'text-dr7-gold font-semibold' : 'text-theme-text-primary'
                    }`}>{cell}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <div className="md:hidden p-3 space-y-2">
        {rows.map((row, ri) => (
          <div key={ri} className="bg-theme-bg-tertiary/30 rounded-lg p-3 border border-theme-border">
            <p className="font-medium text-theme-text-primary text-sm mb-1">{row[0]}</p>
            <div className="flex flex-wrap gap-3 text-xs">
              {headers.slice(1).map((h, hi) => (
                <div key={hi}>
                  <span className="text-theme-text-muted">{h}: </span>
                  <span className={`font-semibold ${
                    row[hi + 1]?.startsWith('€') ? 'text-dr7-gold' :
                    row[hi + 1]?.endsWith('%') ? (parseFloat(row[hi + 1]) < 20 ? 'text-red-400' : 'text-green-400') :
                    'text-theme-text-primary'
                  }`}>{row[hi + 1]}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
