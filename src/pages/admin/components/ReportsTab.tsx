import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'

interface ProCategory { id: string; label: string }

interface BookingDetail {
  booking_id: string
  customer_name: string
  targa: string
  start_at: string
  end_at: string
  billable_days: number
  days_in_month: number
  total_price: number
  revenue_per_day: number
  payment_status: string
  payment_method: string
  penalty_amount?: number
  danni_amount?: number
}

interface VehicleReport {
  vehicleId: string
  label: string
  plate: string
  category: string
  status?: string
  rentedDays: number
  maintenanceDays: number
  idleDays: number
  utilizationRate: number
  downtimeRate: number
  idleRate: number
  // 2026-05-23: nuovo schema. elapsedDays = giorni trascorsi del periodo
  // (denominatore vero usato per utilizationRate). periodTotalDays = giorni
  // totali del periodo (mostrato come "su X giorni" in tooltip/sub).
  elapsedDays?: number
  periodTotalDays?: number
  bookingsCount: number
  rentalRevenue: number
  penaltyRevenue: number
  danniRevenue: number
  totalRevenue: number
  // 2026-05-24: incassi anticipati per veicolo
  anticipatedRevenue?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anticipatedBookings?: AnticipatedBooking[]
  bookings?: BookingDetail[]
}

interface UnmatchedBooking {
  id: string
  vehicle_name: string
  vehicle_plate: string
  vehicle_id: string
}

interface AnticipatedBooking {
  booking_id: string
  customer_name: string
  targa: string
  pickup_date: string
  dropoff_date: string
  total_price: number
  paid_at: string
  payment_method: string
}

interface VehicleReportData {
  month: string
  daysInMonth: number
  vehicleCount: number
  totalBookingsFound: number
  unmatchedBookings?: UnmatchedBooking[]
  totalRentalRevenue: number
  totalPenaltyRevenue: number
  totalDanniRevenue: number
  totalRevenue: number
  // 2026-05-24: incassi anticipati = pagati nel periodo ma rental futuro
  totalAnticipatedRevenue?: number
  anticipatedBookingsCount?: number
  avgUtilizationRate: number
  vehicles: VehicleReport[]
}

interface WashTypeBreakdown {
  type: string
  count: number
  revenue: number
}

interface InternalWashBreakdown {
  vehicle: string
  count: number
}

interface CauzioneReportItem {
  id: string
  cliente: string
  veicolo: string
  targa: string
  importo: number
  metodo: string
  stato: string
  note: string | null
  data_incasso: string | null
  updated_at: string
}

interface CauzioniReportData {
  month: string
  totaleCauzioni: number
  totaleIncassato: number
  totaleRestituito: number
  totaleSbloccato: number
  totaleDanni: number
  byStato: { stato: string; count: number; totale: number }[]
  cauzioni: CauzioneReportItem[]
}

interface WashReportData {
  month: string
  daysInMonth: number
  billableWashesCount: number
  washRevenue: number
  avgWashesPerDay: number
  byType: WashTypeBreakdown[]
  internalWashesCount?: number
  internalByVehicle?: InternalWashBreakdown[]
}

// 2026-05-19: categorie + label + colori erano hardcoded a 4 legacy
// (exotic/urban/moto/utilitaire). Adesso le leggiamo da
// centralina_pro_config.config.categories — stessa fonte di VehiclesTab.
// Cosi' il Report mostra esattamente le categorie + label scelte
// dall'admin in Centralina Pro > Categorie & Fascia, nello stesso
// ordine, e i nomi dei gruppi corrispondono a quelli della Flotta Veicoli.

// Palette colori ciclica usata per i gruppi: l'ordine in centralina_pro_config
// determina quale categoria prende quale colore. Aggiungi più colori se hai
// più di 6 categorie (oltre cicla).
const CATEGORY_PALETTE = [
  { container: 'border-yellow-500/50 bg-yellow-500/5', badge: 'bg-yellow-500/20 text-yellow-400' },
  { container: 'border-blue-500/50 bg-blue-500/5',     badge: 'bg-blue-500/20 text-blue-400'     },
  { container: 'border-purple-500/50 bg-purple-500/5', badge: 'bg-purple-500/20 text-purple-400' },
  { container: 'border-green-500/50 bg-green-500/5',   badge: 'bg-green-500/20 text-green-400'   },
  { container: 'border-pink-500/50 bg-pink-500/5',     badge: 'bg-pink-500/20 text-pink-400'     },
  { container: 'border-cyan-500/50 bg-cyan-500/5',     badge: 'bg-cyan-500/20 text-cyan-400'     },
]
const FALLBACK_STYLE = { container: 'border-theme-border/50 bg-theme-bg-hover/5', badge: 'bg-theme-bg-hover/20 text-theme-text-muted' }

// 2026-05-23: helpers per gestire date in formato europeo DD/MM/YYYY
// dentro text input, evitando il <input type="date"> che segue il
// locale OS (su Mac US mostra MM/DD/YYYY → confusione).
// Internamente lo state resta YYYY-MM-DD (formato API/Supabase).
function isoToEU(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function euToIso(eu: string): string | null {
  // Accetta "DD/MM/YYYY" o "D/M/YY[YY]"
  const m = eu.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (!m) return null
  const d = m[1].padStart(2, '0')
  const mo = m[2].padStart(2, '0')
  let y = m[3]
  if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y
  // validate
  const dt = new Date(`${y}-${mo}-${d}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return null
  return `${y}-${mo}-${d}`
}
function formatEUInput(raw: string): string {
  // Auto-inserisce "/" mentre l'utente digita.
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2)
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4)
}

export default function ReportsTab() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // 2026-05-23: selectedMonth rimosso — sostituito da rangePreset + customFrom/To
  void currentMonth // kept var declaration but no longer used
  const [activeReport, setActiveReport] = useState<'vehicles' | 'washes' | 'cauzioni'>('vehicles')

  // 2026-05-23: range picker (oggi, 7gg, 30gg, mese corrente, anno, custom).
  // Backend ora accetta from+to oltre al legacy month=YYYY-MM. Quando preset
  // === 'mese' uso il legacy `month` per non rompere chi ha link bookmarkati.
  type RangePreset = 'oggi' | '7gg' | '30gg' | 'mese' | 'anno' | 'custom'
  const [rangePreset, setRangePreset] = useState<RangePreset>('mese')
  void now // anchor variabile, todayISO non piu' usato dopo text input
  // 2026-05-24 (fix): formato LOCALE YYYY-MM-DD, NON via toISOString()
  // che convertendo in UTC sposta -1 giorno (Europe/Rome = UTC+1/+2).
  // Bug osservato: "Mese" mostrava 30-aprile → 30-maggio invece di
  // 1-maggio → 31-maggio.
  function fmtLocal(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  function calcRange(preset: RangePreset): { from: string; to: string } {
    const today = new Date()
    const to = fmtLocal(today)
    if (preset === 'oggi') return { from: to, to }
    if (preset === '7gg') {
      const d = new Date(); d.setDate(d.getDate() - 6)
      return { from: fmtLocal(d), to }
    }
    if (preset === '30gg') {
      const d = new Date(); d.setDate(d.getDate() - 29)
      return { from: fmtLocal(d), to }
    }
    // 2026-05-24: Anno = SEMPRE da 1 gennaio a 31 dicembre.
    if (preset === 'anno') {
      const from = fmtLocal(new Date(today.getFullYear(), 0, 1))
      const toYear = fmtLocal(new Date(today.getFullYear(), 11, 31))
      return { from, to: toYear }
    }
    // 2026-05-24: Mese = SEMPRE dal 1° all'ULTIMO giorno del mese corrente.
    if (preset === 'mese') {
      const from = fmtLocal(new Date(today.getFullYear(), today.getMonth(), 1))
      // day 0 del mese successivo = ultimo giorno del mese corrente
      const lastDay = fmtLocal(new Date(today.getFullYear(), today.getMonth() + 1, 0))
      return { from, to: lastDay }
    }
    return { from: to, to }
  }
  const initRange = calcRange('mese')
  const [customFrom, setCustomFrom] = useState(initRange.from)
  const [customTo, setCustomTo] = useState(initRange.to)
  // Draft string per i text input formato europeo. Sync su customFrom/To
  // quando il valore parsato e' valido. L'utente puo' digitare liberamente
  // senza che il valore canonico ISO cambi finche' la data non e' completa.
  const [fromDraft, setFromDraft] = useState(isoToEU(initRange.from))
  const [toDraft, setToDraft] = useState(isoToEU(initRange.to))
  useEffect(() => {
    if (rangePreset !== 'custom') {
      const r = calcRange(rangePreset)
      setCustomFrom(r.from)
      setCustomTo(r.to)
      setFromDraft(isoToEU(r.from))
      setToDraft(isoToEU(r.to))
    }
  }, [rangePreset])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [vehicleData, setVehicleData] = useState<VehicleReportData | null>(null)
  const [washData, setWashData] = useState<WashReportData | null>(null)
  const [cauzioniData, setCauzioniData] = useState<CauzioniReportData | null>(null)

  // 2026-05-19: categorie da Centralina Pro (stessa fonte di VehiclesTab).
  // Realtime sub così add/rename/delete in Categorie & Fascia si propagano.
  const [proCategories, setProCategories] = useState<ProCategory[]>([])
  useEffect(() => {
    let cancelled = false
    async function loadCategories() {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      if (cancelled) return
      const cfg = (data?.config as { categories?: ProCategory[] } | null) || null
      setProCategories(Array.isArray(cfg?.categories) ? cfg.categories : [])
    }
    loadCategories()
    const channel = supabase
      .channel('reports-categories-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' }, (payload) => {
        const cfg = (payload.new as { config?: { categories?: ProCategory[] } } | undefined)?.config
        setProCategories(Array.isArray(cfg?.categories) ? cfg.categories : [])
      })
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [])

  // Mappature derivate da proCategories. Manteniamo "-" come bucket
  // "Altro" per veicoli senza categoria assegnata.
  const CATEGORY_ORDER = useMemo(() => {
    const ids = proCategories.map(c => c.id)
    if (!ids.includes('-')) ids.push('-')
    return ids
  }, [proCategories])
  const CATEGORY_LABELS = useMemo(() => {
    const m: Record<string, string> = { '-': 'Altro' }
    for (const c of proCategories) m[c.id] = c.label || c.id
    return m
  }, [proCategories])
  const CATEGORY_STYLE = useMemo(() => {
    const m: Record<string, typeof FALLBACK_STYLE> = { '-': FALLBACK_STYLE }
    proCategories.forEach((c, i) => { m[c.id] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] })
    return m
  }, [proCategories])

  // Auto-load report on mount and when range / report type changes
  useEffect(() => {
    fetchReport()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReport, rangePreset, customFrom, customTo])

  const [plateSearch, setPlateSearch] = useState('')
  const [sortField, setSortField] = useState<keyof VehicleReport>('utilizationRate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedVehicle, setExpandedVehicle] = useState<string | null>(null)

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      // Backend supporta sia month=YYYY-MM (legacy) che from+to=YYYY-MM-DD.
      // Custom range / preset 7gg / 30gg / anno / oggi → mandiamo from+to.
      const url = `/.netlify/functions/monthly-report?type=${activeReport}&from=${customFrom}&to=${customTo}`
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel caricamento')
      if (activeReport === 'vehicles') {
        setVehicleData(data)
      } else if (activeReport === 'washes') {
        setWashData(data)
      } else {
        setCauzioniData(data)
      }
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      setError(_errMsg || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  function handleSort(field: keyof VehicleReport) {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const filteredVehicles = vehicleData?.vehicles
    ? vehicleData.vehicles.filter(v => {
        // Hide retired vehicles with zero activity in this month
        if (v.status === 'retired' && v.rentedDays === 0 && v.totalRevenue === 0) return false
        if (!plateSearch.trim()) return true
        const q = plateSearch.trim().toLowerCase().replace(/\s/g, '')
        const plate = (v.plate || '').toLowerCase().replace(/\s/g, '')
        const name = (v.label || '').toLowerCase()
        return plate.includes(q) || name.includes(q)
      })
    : []

  function sortVehicles(list: VehicleReport[]) {
    return [...list].sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }
      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal))
    })
  }

  // Group vehicles by category
  function getGroupedVehicles() {
    const groups: { category: string; vehicles: VehicleReport[] }[] = []
    const byCategory: Record<string, VehicleReport[]> = {}

    filteredVehicles.forEach(v => {
      const cat = v.category || '-'
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(v)
    })

    // Sort by predefined order, unknown categories at the end
    const allCategories = Object.keys(byCategory)
    allCategories.sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a)
      const bi = CATEGORY_ORDER.indexOf(b)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })

    allCategories.forEach(cat => {
      groups.push({ category: cat, vehicles: sortVehicles(byCategory[cat]) })
    })

    return groups
  }

  function getCategorySummary(vehicles: VehicleReport[]) {
    const totalRented = vehicles.reduce((s, v) => s + v.rentedDays, 0)
    const totalRentalRevenue = vehicles.reduce((s, v) => s + v.rentalRevenue, 0)
    const totalPenaltyRevenue = vehicles.reduce((s, v) => s + v.penaltyRevenue, 0)
    const totalDanniRevenue = vehicles.reduce((s, v) => s + v.danniRevenue, 0)
    const totalRevenue = vehicles.reduce((s, v) => s + v.totalRevenue, 0)
    const avgUtil = vehicles.length > 0
      ? vehicles.reduce((s, v) => s + v.utilizationRate, 0) / vehicles.length
      : 0
    return { totalRented, totalRentalRevenue, totalPenaltyRevenue, totalDanniRevenue, totalRevenue, avgUtil, count: vehicles.length }
  }

  function formatPercent(rate: number): string {
    return `${Math.round(rate * 100)}%`
  }

  function formatCurrency(amount: number): string {
    return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  function getUtilizationColor(rate: number): string {
    if (rate >= 0.7) return 'text-green-400'
    if (rate >= 0.4) return 'text-yellow-400'
    return 'text-red-400'
  }

  function getPaymentBadge(status: string, method: string): { label: string; color: string } {
    const isPaid = status === 'paid' || status === 'completed' || status === 'succeeded'
    if (method === 'credit' || status === 'succeeded') {
      return { label: 'Wallet', color: 'bg-purple-500/20 text-purple-400' }
    }
    if (isPaid) {
      return { label: 'Pagato', color: 'bg-green-500/20 text-green-400' }
    }
    return { label: status || 'N/A', color: 'bg-theme-bg-hover/20 text-theme-text-muted' }
  }

  function formatDateIT(dateStr: string): string {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
  }

  const grouped = getGroupedVehicles()

  const tableHeader = (
    <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
      <th className="text-left px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('label')}>
        Veicolo {sortField === 'label' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-left px-4 py-3">Targa</th>
      <th className="text-center px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('rentedDays')}>
        Noleggiato {sortField === 'rentedDays' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-center px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('maintenanceDays')}>
        Manut. {sortField === 'maintenanceDays' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-center px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('idleDays')}>
        Fermo {sortField === 'idleDays' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-center px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('utilizationRate')}>
        Utilizzo {sortField === 'utilizationRate' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-center px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('bookingsCount')}>
        Pren. {sortField === 'bookingsCount' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-right px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('rentalRevenue')}>
        Noleggio {sortField === 'rentalRevenue' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-right px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('penaltyRevenue')}>
        Penale {sortField === 'penaltyRevenue' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-right px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('danniRevenue')}>
        Danni {sortField === 'danniRevenue' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-right px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('totalRevenue')}>
        TOTALE {sortField === 'totalRevenue' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
    </tr>
  )

  // Mobile card view for a vehicle
  function renderVehicleCard(v: VehicleReport) {
    const isExpanded = expandedVehicle === v.vehicleId
    return (
      <div
        key={v.vehicleId}
        className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border cursor-pointer"
        onClick={() => setExpandedVehicle(isExpanded ? null : v.vehicleId)}
      >
        {/* Header with name and plate */}
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="font-semibold text-theme-text-primary text-sm">
              <span className="mr-1 text-xs text-theme-text-muted">{isExpanded ? '▼' : '▶'}</span>
              {v.label}
            </p>
            <p className="text-xs text-theme-text-muted">{v.plate}</p>
          </div>
          <div className="text-right">
            <span className={`text-lg font-bold ${getUtilizationColor(v.utilizationRate)}`}>
              {formatPercent(v.utilizationRate)}
            </span>
            {v.elapsedDays != null && v.periodTotalDays != null && (
              <div className="text-[10px] text-theme-text-muted mt-0.5" title={`Calcolato su ${v.elapsedDays} giorni trascorsi del periodo (totale ${v.periodTotalDays}gg)`}>
                {v.rentedDays}/{v.elapsedDays}gg trascorsi
              </div>
            )}
          </div>
        </div>
        {/* Progress bar */}
        <div className="w-full h-2 bg-theme-bg-tertiary rounded-full mb-3">
          <div
            className={`h-full rounded-full ${v.utilizationRate >= 0.7 ? 'bg-green-400' : v.utilizationRate >= 0.4 ? 'bg-yellow-400' : 'bg-red-400'}`}
            style={{ width: `${Math.round(v.utilizationRate * 100)}%` }}
          />
        </div>
        {/* Stats grid — 2026-05-24: 4° colonna "Anticipi" mostrata SOLO
            quando il veicolo ha pagamenti anticipati nel periodo,
            cosi' la riga non si affolla per chi non ne ha. */}
        <div className={`grid ${(v.anticipatedBookings?.length || 0) > 0 ? 'grid-cols-4' : 'grid-cols-3'} gap-2 text-center text-xs mb-3`}>
          <div>
            <p className="text-green-400 font-bold">{v.rentedDays}g</p>
            <p className="text-theme-text-muted">Noleggio</p>
          </div>
          <div>
            <p className="text-orange-400 font-bold">{v.maintenanceDays}g</p>
            <p className="text-theme-text-muted">Manut.</p>
          </div>
          <div>
            <p className="text-theme-text-primary font-bold">{v.bookingsCount}</p>
            <p className="text-theme-text-muted">Pren.</p>
          </div>
          {(v.anticipatedBookings?.length || 0) > 0 && (
            <div>
              <p className="text-cyan-400 font-bold">{v.anticipatedBookings?.length || 0}</p>
              <p className="text-theme-text-muted">Anticipi</p>
            </div>
          )}
        </div>
        {/* Revenue breakdown — 2026-05-26: tutte le 5 righe SEMPRE visibili
            nell'ordine fissato dalla direzione:
            1. Ricavo noleggio del mese
            2. Ricavo noleggio anticipato
            3. Ricavo penale
            4. Ricavo danni
            5. Ricavo TOTALE */}
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-theme-text-muted">Ricavo noleggio del mese</span>
            <span className="text-theme-text-primary font-semibold">{formatCurrency(v.rentalRevenue)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-theme-text-muted">Ricavo noleggio anticipato</span>
            <span className="text-cyan-400 font-semibold">{formatCurrency(v.anticipatedRevenue || 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-theme-text-muted">Ricavo penale</span>
            <span className="text-yellow-400 font-semibold">{formatCurrency(v.penaltyRevenue)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-theme-text-muted">Ricavo danni</span>
            <span className="text-red-400 font-semibold">{formatCurrency(v.danniRevenue)}</span>
          </div>
          <div className="flex justify-between pt-1 border-t border-theme-border/50">
            <span className="text-theme-text-muted font-bold">Ricavo TOTALE</span>
            <span className="text-dr7-gold font-bold">{formatCurrency(v.totalRevenue + (v.anticipatedRevenue || 0))}</span>
          </div>
        </div>
        {/* Expanded booking details — same data as the desktop expanded
            row (Cliente, Ritiro, Riconsegna, GG Tot/Mese, Pagamento,
            Totale, Penali, Danni, Ricavo Mese) but stacked in cards so
            it's readable on mobile without horizontal scroll. */}
        {isExpanded && v.bookings && v.bookings.length > 0 && (
          <div className="mt-3 pt-3 border-t border-theme-border space-y-2">
            <p className="text-xs font-semibold text-theme-text-muted mb-1">Dettaglio Prenotazioni:</p>
            {v.bookings.map((b: BookingDetail) => {
              const badge = getPaymentBadge(b.payment_status, b.payment_method)
              const pen = b.penalty_amount || 0
              const dan = b.danni_amount || 0
              // 2026-05-22: Ricavo Mese = noleggio proporzionato + penali + danni.
              // Prima sommavamo solo il noleggio: l'admin vedeva €1579 invece di
              // €1579+€880 di penali = €2459. Penali/danni sono one-time charges,
              // si sommano interi (no proration) — coerente con il totale veicolo
              // che gia' include penaltyRevenue + danniRevenue sul backend.
              const rentalInMonth = b.billable_days > 0
                ? (b.total_price / b.billable_days) * b.days_in_month
                : b.total_price
              const revInMonth = Math.round((rentalInMonth + pen + dan) * 100) / 100
              return (
                <div
                  key={b.booking_id}
                  className="bg-theme-bg-primary/30 rounded p-2 text-xs"
                  onClick={e => e.stopPropagation()}
                >
                  {/* Header: customer + payment badge */}
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-medium text-theme-text-primary truncate">{b.customer_name}</span>
                    <span className={`shrink-0 ml-2 px-2 py-0.5 rounded-full font-semibold ${badge.color}`}>{badge.label}</span>
                  </div>

                  {/* Date range */}
                  <div className="text-theme-text-muted mb-1.5">
                    <span>{formatDateIT(b.start_at)} → {formatDateIT(b.end_at)}</span>
                  </div>

                  {/* Days: total / in-month */}
                  <div className="flex justify-between text-theme-text-muted mb-1.5">
                    <span>GG totali</span>
                    <span className="text-theme-text-primary font-medium">{b.billable_days}g</span>
                  </div>
                  <div className="flex justify-between text-theme-text-muted mb-1.5">
                    <span>GG nel mese</span>
                    <span className="text-green-400 font-medium">{b.days_in_month}g</span>
                  </div>

                  {/* Ricavo noleggio (prorated to the month if cross-month) */}
                  <div className="flex justify-between mb-1.5">
                    <span className="text-theme-text-muted">Ricavo noleggio</span>
                    <span className="text-theme-text-primary font-semibold">{formatCurrency(rentalInMonth)}</span>
                  </div>

                  {/* Ricavo penale (only if > 0) */}
                  {pen > 0 && (
                    <div className="flex justify-between mb-1.5">
                      <span className="text-theme-text-muted">Ricavo penale</span>
                      <span className="text-yellow-400 font-semibold">{formatCurrency(pen)}</span>
                    </div>
                  )}

                  {/* Ricavo danni (only if > 0) */}
                  {dan > 0 && (
                    <div className="flex justify-between mb-1.5">
                      <span className="text-theme-text-muted">Ricavo danni</span>
                      <span className="text-red-400 font-semibold">{formatCurrency(dan)}</span>
                    </div>
                  )}

                  {/* Ricavo Mese — somma di noleggio (prorato) + penale + danni.
                      Coerente con la colonna "Ricavo Mese" della tabella desktop. */}
                  <div className="flex justify-between pt-1.5 border-t border-theme-border/40">
                    <span className="text-theme-text-muted font-semibold">Ricavo Mese</span>
                    <span className="text-dr7-gold font-bold">{formatCurrency(revInMonth)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {/* Dettaglio Anticipi per veicolo — bookings pagati nel periodo
            ma con pickup futuro. Mostra cliente, range date, importo,
            pagato il. Stessa logica del riepilogo globale ma per veicolo. */}
        {isExpanded && (v.anticipatedBookings?.length || 0) > 0 && (
          <div className="mt-3 pt-3 border-t border-theme-border space-y-2">
            <p className="text-xs font-semibold text-cyan-400 mb-1">Dettaglio Anticipi:</p>
            {(v.anticipatedBookings || []).map((ab) => (
              <div
                key={`ant-${ab.booking_id}`}
                className="bg-cyan-500/5 border border-cyan-500/20 rounded p-2 text-xs"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-medium text-theme-text-primary truncate">{ab.customer_name}</span>
                  <span className="shrink-0 ml-2 px-2 py-0.5 rounded-full font-semibold bg-cyan-500/20 text-cyan-300">Anticipato</span>
                </div>
                <div className="text-theme-text-muted mb-1.5">
                  <span>{formatDateIT(ab.pickup_date)} → {formatDateIT(ab.dropoff_date)}</span>
                </div>
                <div className="flex justify-between text-theme-text-muted mb-1.5">
                  <span>Pagato il</span>
                  <span className="text-theme-text-primary">{formatDateIT(ab.paid_at)}</span>
                </div>
                <div className="flex justify-between text-theme-text-muted mb-1.5">
                  <span>Metodo</span>
                  <span className="text-theme-text-primary">{ab.payment_method || '—'}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-theme-border/40">
                  <span className="text-theme-text-muted font-semibold">Totale</span>
                  <span className="text-cyan-400 font-bold">{formatCurrency(ab.total_price)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Desktop table row for a vehicle (clickable to expand booking details)
  function renderVehicleRow(v: VehicleReport) {
    const isExpanded = expandedVehicle === v.vehicleId
    return (
      <>
        <tr
          key={v.vehicleId}
          className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors cursor-pointer"
          onClick={() => setExpandedVehicle(isExpanded ? null : v.vehicleId)}
        >
          <td className="px-4 py-3 font-medium text-theme-text-primary">
            <span className="mr-2 text-xs text-theme-text-muted">{isExpanded ? '▼' : '▶'}</span>
            {v.label}
          </td>
          <td className="px-4 py-3 text-theme-text-muted text-xs">{v.plate}</td>
          <td className="text-center px-4 py-3">
            <span className="text-green-400 font-semibold">{v.rentedDays}g</span>
          </td>
          <td className="text-center px-4 py-3">
            <span className="text-orange-400 font-semibold">{v.maintenanceDays}g</span>
          </td>
          <td className="text-center px-4 py-3">
            <span className="text-theme-text-muted">{v.idleDays}g</span>
          </td>
          <td className="text-center px-4 py-3">
            <span className={`font-bold ${getUtilizationColor(v.utilizationRate)}`}>
              {formatPercent(v.utilizationRate)}
            </span>
            <div className="w-full h-1.5 bg-theme-bg-tertiary rounded-full mt-1">
              <div
                className={`h-full rounded-full ${v.utilizationRate >= 0.7 ? 'bg-green-400' : v.utilizationRate >= 0.4 ? 'bg-yellow-400' : 'bg-red-400'}`}
                style={{ width: `${Math.round(v.utilizationRate * 100)}%` }}
              />
            </div>
          </td>
          <td className="text-center px-4 py-3 text-theme-text-primary">{v.bookingsCount}</td>
          <td className="text-right px-4 py-3 text-theme-text-primary font-semibold">{formatCurrency(v.rentalRevenue)}</td>
          <td className="text-right px-4 py-3 text-yellow-400 font-semibold">{v.penaltyRevenue > 0 ? formatCurrency(v.penaltyRevenue) : '-'}</td>
          <td className="text-right px-4 py-3 text-red-400 font-semibold">{v.danniRevenue > 0 ? formatCurrency(v.danniRevenue) : '-'}</td>
          <td className="text-right px-4 py-3 text-dr7-gold font-bold">{formatCurrency(v.totalRevenue)}</td>
        </tr>
        {isExpanded && v.bookings && v.bookings.length > 0 && (
          <tr key={`${v.vehicleId}-details`}>
            <td colSpan={11} className="px-4 py-2 bg-theme-bg-primary/30">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-theme-text-muted">
                    <th className="text-left py-1 px-2">Cliente</th>
                    <th className="text-left py-1 px-2">Ritiro</th>
                    <th className="text-left py-1 px-2">Riconsegna</th>
                    <th className="text-center py-1 px-2">GG Tot.</th>
                    <th className="text-center py-1 px-2">GG Mese</th>
                    <th className="text-center py-1 px-2">Pagamento</th>
                    <th className="text-right py-1 px-2">Totale</th>
                    <th className="text-right py-1 px-2">Penali</th>
                    <th className="text-right py-1 px-2">Danni</th>
                    <th className="text-right py-1 px-2">Ricavo Mese</th>
                  </tr>
                </thead>
                <tbody>
                  {v.bookings.map((b: BookingDetail) => {
                    const badge = getPaymentBadge(b.payment_status, b.payment_method)
                    const pen = b.penalty_amount || 0
                    const dan = b.danni_amount || 0
                    return (
                      <tr key={b.booking_id} className="border-t border-theme-border/30">
                        <td className="py-1 px-2 text-theme-text-primary font-medium">{b.customer_name}</td>
                        <td className="py-1 px-2 text-theme-text-muted">{formatDateIT(b.start_at)}</td>
                        <td className="py-1 px-2 text-theme-text-muted">{formatDateIT(b.end_at)}</td>
                        <td className="text-center py-1 px-2 text-theme-text-primary">{b.billable_days}g</td>
                        <td className="text-center py-1 px-2 text-green-400">{b.days_in_month}g</td>
                        <td className="text-center py-1 px-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.color}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="text-right py-1 px-2 text-theme-text-primary">{formatCurrency(b.total_price)}</td>
                        <td className={`text-right py-1 px-2 font-semibold ${pen > 0 ? 'text-yellow-400' : 'text-theme-text-muted'}`}>
                          {pen > 0 ? formatCurrency(pen) : '—'}
                        </td>
                        <td className={`text-right py-1 px-2 font-semibold ${dan > 0 ? 'text-red-400' : 'text-theme-text-muted'}`}>
                          {dan > 0 ? formatCurrency(dan) : '—'}
                        </td>
                        <td className="text-right py-1 px-2 text-dr7-gold">
                          {formatCurrency(
                            (b.billable_days > 0 ? (b.total_price / b.billable_days) * b.days_in_month : b.total_price)
                            + pen + dan
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {/* Anticipi per veicolo — bookings pagati nel periodo ma con
                  pickup futuro. Sotto la tabella principale, con header
                  cyan per distinguerli dai noleggi del mese. */}
              {(v.anticipatedBookings?.length || 0) > 0 && (
                <div className="mt-3 pt-3 border-t border-cyan-500/20">
                  <p className="text-xs font-semibold text-cyan-400 mb-2">
                    Anticipi ({v.anticipatedBookings?.length || 0}) — pagati nel periodo, noleggio futuro
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-theme-text-muted">
                        <th className="text-left py-1 px-2">Cliente</th>
                        <th className="text-left py-1 px-2">Ritiro</th>
                        <th className="text-left py-1 px-2">Riconsegna</th>
                        <th className="text-left py-1 px-2">Pagato il</th>
                        <th className="text-center py-1 px-2">Metodo</th>
                        <th className="text-right py-1 px-2">Totale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(v.anticipatedBookings || []).map((ab) => (
                        <tr key={`ant-${ab.booking_id}`} className="border-t border-theme-border/30 bg-cyan-500/5">
                          <td className="py-1 px-2 text-theme-text-primary font-medium">{ab.customer_name}</td>
                          <td className="py-1 px-2 text-theme-text-muted">{formatDateIT(ab.pickup_date)}</td>
                          <td className="py-1 px-2 text-theme-text-muted">{formatDateIT(ab.dropoff_date)}</td>
                          <td className="py-1 px-2 text-theme-text-muted">{formatDateIT(ab.paid_at)}</td>
                          <td className="text-center py-1 px-2 text-theme-text-primary">{ab.payment_method || '—'}</td>
                          <td className="text-right py-1 px-2 text-cyan-400 font-semibold">{formatCurrency(ab.total_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </td>
          </tr>
        )}
      </>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-theme-text-primary">Report Mensili</h2>
      </div>

      {/* Controls */}
      <div className="bg-theme-bg-secondary/50 backdrop-blur-sm rounded-xl border border-theme-border p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          {/* Report Type Toggle */}
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Tipo Report</label>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveReport('vehicles')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                  activeReport === 'vehicles'
                    ? 'bg-dr7-gold text-white border-dr7-gold'
                    : 'bg-transparent text-theme-text-primary border-theme-text-primary hover:bg-theme-text-primary hover:text-theme-bg-primary'
                }`}
              >
                Veicoli
              </button>
              <button
                onClick={() => setActiveReport('cauzioni')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                  activeReport === 'cauzioni'
                    ? 'bg-dr7-gold text-white border-dr7-gold'
                    : 'bg-transparent text-theme-text-primary border-theme-text-primary hover:bg-theme-text-primary hover:text-theme-bg-primary'
                }`}
              >
                Cauzioni
              </button>
            </div>
          </div>

          {/* Range Selector — 2026-05-23: sostituito month picker singolo
              con preset (oggi / 7gg / 30gg / mese / anno / custom) + date
              from/to per range arbitrari. Tutti i preset settano custom*
              automaticamente; quando preset='custom' i date input sono
              modificabili a mano. */}
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Periodo</label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border border-theme-border bg-theme-bg-tertiary p-0.5 text-xs">
                {([
                  { key: 'oggi', label: 'Oggi' },
                  { key: 'mese', label: 'Mese' },
                  { key: '7gg', label: '7gg' },
                  { key: '30gg', label: '30gg' },
                  { key: 'anno', label: 'Anno' },
                  { key: 'custom', label: 'Custom' },
                ] as { key: RangePreset; label: string }[]).map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      // 2026-05-25: ricalcola SEMPRE le date al click, anche se il
                      // preset e' gia' attivo. Prima il setState non scattava se
                      // il valore era invariato e l'useEffect non fireva, lasciando
                      // date stale (es. "Mese" mostrava 30/04-30/05 dal vecchio
                      // bug timezone, click su "Mese" non resettava).
                      setRangePreset(p.key)
                      if (p.key !== 'custom') {
                        const r = calcRange(p.key)
                        setCustomFrom(r.from)
                        setCustomTo(r.to)
                        setFromDraft(isoToEU(r.from))
                        setToDraft(isoToEU(r.to))
                      }
                    }}
                    className={`px-3 py-1 rounded ${rangePreset === p.key ? 'bg-dr7-gold text-white font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {/* 2026-05-23: text input DD/MM/YYYY (formato europeo) invece
                  di <input type="date"> che segue il locale OS. Auto-formatta
                  con "/" mentre l'utente digita. Sincronizza customFrom/To
                  (ISO) solo quando la data parsata e' valida. */}
              <input
                type="text"
                inputMode="numeric"
                placeholder="GG/MM/AAAA"
                maxLength={10}
                value={fromDraft}
                onChange={(e) => {
                  const formatted = formatEUInput(e.target.value)
                  setFromDraft(formatted)
                  setRangePreset('custom')
                  const iso = euToIso(formatted)
                  if (iso) setCustomFrom(iso)
                }}
                onBlur={() => { setFromDraft(isoToEU(customFrom)) }}
                className="px-2 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-xs font-mono tabular-nums w-28"
              />
              <span className="text-theme-text-muted text-xs">→</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="GG/MM/AAAA"
                maxLength={10}
                value={toDraft}
                onChange={(e) => {
                  const formatted = formatEUInput(e.target.value)
                  setToDraft(formatted)
                  setRangePreset('custom')
                  const iso = euToIso(formatted)
                  if (iso) setCustomTo(iso)
                }}
                onBlur={() => { setToDraft(isoToEU(customTo)) }}
                className="px-2 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-xs font-mono tabular-nums w-28"
              />
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={fetchReport}
            disabled={loading}
            className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors disabled:opacity-50"
          >
            {loading ? 'Caricamento...' : 'Aggiorna'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Vehicle Report */}
      {activeReport === 'vehicles' && vehicleData && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Veicoli Attivi</p>
              <p className="text-2xl font-bold text-theme-text-primary">{vehicleData.vehicleCount}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Prenotazioni Trovate</p>
              <p className="text-2xl font-bold text-theme-text-primary">{vehicleData.totalBookingsFound}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Giorni nel Mese</p>
              <p className="text-2xl font-bold text-theme-text-primary">{vehicleData.daysInMonth}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Utilizzo Medio</p>
              <p className={`text-2xl font-bold ${getUtilizationColor(vehicleData.avgUtilizationRate)}`}>
                {formatPercent(vehicleData.avgUtilizationRate)}
              </p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Ricavo Noleggi</p>
              <p className="text-2xl font-bold text-theme-text-primary">{formatCurrency(vehicleData.totalRentalRevenue)}</p>
            </div>
            {vehicleData.totalPenaltyRevenue > 0 && (
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-yellow-500/30 p-4">
                <p className="text-xs text-theme-text-muted">Ricavo Penali</p>
                <p className="text-2xl font-bold text-yellow-400">{formatCurrency(vehicleData.totalPenaltyRevenue)}</p>
              </div>
            )}
            {vehicleData.totalDanniRevenue > 0 && (
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-red-500/30 p-4">
                <p className="text-xs text-theme-text-muted">Ricavo Danni</p>
                <p className="text-2xl font-bold text-red-400">{formatCurrency(vehicleData.totalDanniRevenue)}</p>
              </div>
            )}
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-dr7-gold/30 p-4">
              <p className="text-xs text-theme-text-muted">Ricavo TOTALE</p>
              <p className="text-2xl font-bold text-dr7-gold">{formatCurrency(vehicleData.totalRevenue)}</p>
            </div>
            {/* 2026-05-24: Incassi anticipati SEMPRE visibile cosi' l'admin
                vede chiaramente il valore anche quando e' 0 (e capisce che
                la metrica viene calcolata). */}
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-cyan-500/30 p-4">
              <p className="text-xs text-theme-text-muted">Incassi Anticipati</p>
              <p className="text-2xl font-bold text-cyan-400">{formatCurrency(vehicleData.totalAnticipatedRevenue || 0)}</p>
              <p className="text-[10px] text-theme-text-muted mt-0.5">{vehicleData.anticipatedBookingsCount || 0} prenotazioni — rental futuro</p>
            </div>
          </div>

          {/* 2026-05-24: Tabella dettaglio incassi anticipati — solo se ce ne sono */}
          {(vehicleData.totalAnticipatedRevenue ?? 0) > 0 && (
            <div className="bg-theme-bg-secondary/30 border border-cyan-500/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-cyan-400">Incassi Anticipati nel Periodo</h3>
                  <p className="text-[11px] text-theme-text-muted">Pagati nel periodo selezionato — il noleggio sarà in un mese futuro. Conteggiati a parte dal Ricavo TOTALE per non gonfiare il fatturato del mese.</p>
                </div>
                <span className="text-xl font-bold text-cyan-400 tabular-nums">{formatCurrency(vehicleData.totalAnticipatedRevenue || 0)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-theme-text-muted border-b border-theme-border">
                      <th className="text-left px-2 py-1.5 font-medium">Veicolo</th>
                      <th className="text-left px-2 py-1.5 font-medium">Cliente</th>
                      <th className="text-left px-2 py-1.5 font-medium">Ritiro → Riconsegna</th>
                      <th className="text-left px-2 py-1.5 font-medium">Pagato il</th>
                      <th className="text-left px-2 py-1.5 font-medium">Metodo</th>
                      <th className="text-right px-2 py-1.5 font-medium">Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicleData.vehicles.flatMap(v =>
                      (v.anticipatedBookings || []).map(ab => (
                        <tr key={ab.booking_id} className="border-b border-theme-border/30">
                          <td className="px-2 py-1.5 text-theme-text-primary">{v.label} <span className="text-theme-text-muted">({ab.targa})</span></td>
                          <td className="px-2 py-1.5 text-theme-text-primary">{ab.customer_name}</td>
                          <td className="px-2 py-1.5 text-theme-text-muted tabular-nums">{formatDateIT(ab.pickup_date)} → {formatDateIT(ab.dropoff_date)}</td>
                          <td className="px-2 py-1.5 text-cyan-400 tabular-nums">{ab.paid_at ? formatDateIT(ab.paid_at) : '—'}</td>
                          <td className="px-2 py-1.5 text-theme-text-muted">{ab.payment_method}</td>
                          <td className="px-2 py-1.5 text-right font-bold text-cyan-400 tabular-nums">{formatCurrency(ab.total_price)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Plate Search */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Cerca per targa o nome..."
              value={plateSearch}
              onChange={(e) => setPlateSearch(e.target.value)}
              className="px-4 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm placeholder-theme-text-muted w-full max-w-xs"
            />
            {plateSearch && (
              <span className="text-xs text-theme-text-muted">
                {filteredVehicles.length} di {vehicleData.vehicleCount} veicoli
              </span>
            )}
          </div>

          {/* Vehicle Tables grouped by category */}
          {grouped.map(group => {
            const summary = getCategorySummary(group.vehicles)
            const catLabel = CATEGORY_LABELS[group.category] || group.category
            const catStyle = CATEGORY_STYLE[group.category] || FALLBACK_STYLE
            const catColor = catStyle.container
            const badgeColor = catStyle.badge

            return (
              <div key={group.category} className={`rounded-xl border overflow-hidden ${catColor}`}>
                {/* Category Header */}
                <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-theme-border">
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${badgeColor}`}>
                      {catLabel}
                    </span>
                    <span className="text-sm text-theme-text-muted">{summary.count} veicoli</span>
                  </div>
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1 sm:gap-4 text-xs">
                    <span className="text-theme-text-muted">
                      Utilizzo: <span className={`font-bold ${getUtilizationColor(summary.avgUtil)}`}>{formatPercent(summary.avgUtil)}</span>
                    </span>
                    <span className="text-theme-text-muted">
                      Ricavo: <span className="font-bold text-dr7-gold">{formatCurrency(summary.totalRevenue)}</span>
                    </span>
                  </div>
                </div>
                {/* Desktop Table - hidden on mobile */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>{tableHeader}</thead>
                    <tbody>
                      {group.vehicles.map(v => renderVehicleRow(v))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile Cards - hidden on desktop */}
                <div className="md:hidden p-3 space-y-3">
                  {group.vehicles.map(v => renderVehicleCard(v))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Wash Report */}
      {activeReport === 'washes' && washData && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Lavaggi Fatturabili</p>
              <p className="text-2xl font-bold text-theme-text-primary">{washData.billableWashesCount}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Ricavo Lavaggi</p>
              <p className="text-2xl font-bold text-dr7-gold">{formatCurrency(washData.washRevenue)}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Media Lavaggi / Giorno</p>
              <p className="text-2xl font-bold text-theme-text-primary">{washData.avgWashesPerDay}</p>
            </div>
          </div>

          {/* Breakdown by Type */}
          {washData.byType.length > 0 && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
              <div className="px-4 py-3 border-b border-theme-border">
                <h3 className="text-sm font-semibold text-theme-text-primary">Dettaglio per Tipo di Servizio</h3>
              </div>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                      <th className="text-left px-4 py-3">Servizio</th>
                      <th className="text-center px-4 py-3">Quantità</th>
                      <th className="text-right px-4 py-3">Ricavo</th>
                      <th className="text-right px-4 py-3">% del Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {washData.byType.map(item => (
                      <tr key={item.type} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-theme-text-primary">{item.type}</td>
                        <td className="text-center px-4 py-3 text-theme-text-primary">{item.count}</td>
                        <td className="text-right px-4 py-3 text-dr7-gold font-semibold">{formatCurrency(item.revenue)}</td>
                        <td className="text-right px-4 py-3 text-theme-text-muted">
                          {washData.washRevenue > 0 ? Math.round((item.revenue / washData.washRevenue) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-dr7-gold/30 bg-theme-bg-primary/30">
                      <td className="px-4 py-3 font-bold text-theme-text-primary">Totale</td>
                      <td className="text-center px-4 py-3 font-bold text-theme-text-primary">{washData.billableWashesCount}</td>
                      <td className="text-right px-4 py-3 font-bold text-dr7-gold">{formatCurrency(washData.washRevenue)}</td>
                      <td className="text-right px-4 py-3 font-bold text-theme-text-muted">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* Mobile Cards */}
              <div className="md:hidden p-3 space-y-3">
                {washData.byType.map(item => (
                  <div key={item.type} className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border">
                    <div className="flex justify-between items-start mb-2">
                      <p className="font-semibold text-theme-text-primary text-sm">{item.type}</p>
                      <span className="text-xs bg-theme-bg-tertiary px-2 py-1 rounded-full text-theme-text-muted">
                        {washData.washRevenue > 0 ? Math.round((item.revenue / washData.washRevenue) * 100) : 0}%
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div>
                        <p className="text-lg font-bold text-theme-text-primary">{item.count}</p>
                        <p className="text-xs text-theme-text-muted">Quantità</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-dr7-gold">{formatCurrency(item.revenue)}</p>
                        <p className="text-xs text-theme-text-muted">Ricavo</p>
                      </div>
                    </div>
                  </div>
                ))}
                {/* Mobile Total Card */}
                <div className="bg-dr7-gold/10 rounded-lg p-4 border border-dr7-gold/30">
                  <p className="font-bold text-theme-text-primary text-sm mb-2">Totale</p>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div>
                      <p className="text-lg font-bold text-theme-text-primary">{washData.billableWashesCount}</p>
                      <p className="text-xs text-theme-text-muted">Lavaggi</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-dr7-gold">{formatCurrency(washData.washRevenue)}</p>
                      <p className="text-xs text-theme-text-muted">Ricavo</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {washData.byType.length === 0 && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
              <p className="text-theme-text-muted">Nessun lavaggio fatturabile trovato per questo mese.</p>
            </div>
          )}

          {/* Internal Rientro Washes */}
          {washData.internalWashesCount != null && washData.internalWashesCount > 0 && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-orange-500/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-orange-500/30 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-theme-text-primary">Lavaggi Rientro (Interni)</h3>
                <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded-full font-semibold">
                  {washData.internalWashesCount} lavaggi
                </span>
              </div>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                      <th className="text-left px-4 py-3">Veicolo</th>
                      <th className="text-center px-4 py-3">Quantità</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(washData.internalByVehicle || []).map(item => (
                      <tr key={item.vehicle} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-theme-text-primary">{item.vehicle}</td>
                        <td className="text-center px-4 py-3 text-theme-text-primary">{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-orange-500/30 bg-theme-bg-primary/30">
                      <td className="px-4 py-3 font-bold text-theme-text-primary">Totale Interni</td>
                      <td className="text-center px-4 py-3 font-bold text-theme-text-primary">{washData.internalWashesCount}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* Mobile Cards */}
              <div className="md:hidden p-3 space-y-2">
                {(washData.internalByVehicle || []).map(item => (
                  <div key={item.vehicle} className="bg-theme-bg-tertiary/30 rounded-lg p-3 border border-theme-border flex justify-between items-center">
                    <p className="font-medium text-theme-text-primary text-sm">{item.vehicle}</p>
                    <span className="text-orange-400 font-bold">{item.count}</span>
                  </div>
                ))}
                {/* Mobile Total */}
                <div className="bg-orange-500/10 rounded-lg p-3 border border-orange-500/30 flex justify-between items-center">
                  <p className="font-bold text-theme-text-primary text-sm">Totale Interni</p>
                  <span className="text-orange-400 font-bold text-lg">{washData.internalWashesCount}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cauzioni Report */}
      {activeReport === 'cauzioni' && cauzioniData && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Totale Operazioni</p>
              <p className="text-2xl font-bold text-theme-text-primary">{cauzioniData.totaleCauzioni}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-red-500/30 p-4">
              <p className="text-xs text-theme-text-muted">Incassato (Cassa)</p>
              <p className="text-2xl font-bold text-red-500">{formatCurrency(cauzioniData.totaleIncassato)}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-green-500/30 p-4">
              <p className="text-xs text-theme-text-muted">Restituito</p>
              <p className="text-2xl font-bold text-green-500">{formatCurrency(cauzioniData.totaleRestituito)}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-blue-500/30 p-4">
              <p className="text-xs text-theme-text-muted">Sbloccato</p>
              <p className="text-2xl font-bold text-blue-500">{formatCurrency(cauzioniData.totaleSbloccato)}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-orange-500/30 p-4">
              <p className="text-xs text-theme-text-muted">Danni</p>
              <p className="text-2xl font-bold text-orange-500">{formatCurrency(cauzioniData.totaleDanni)}</p>
            </div>
          </div>

          {/* Cauzioni Table */}
          {cauzioniData.cauzioni.length > 0 ? (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                      <th className="text-left px-4 py-3">Cliente</th>
                      <th className="text-left px-4 py-3">Veicolo</th>
                      <th className="text-right px-4 py-3">Importo</th>
                      <th className="text-center px-4 py-3">Metodo</th>
                      <th className="text-center px-4 py-3">Stato</th>
                      <th className="text-left px-4 py-3">Note</th>
                      <th className="text-left px-4 py-3">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cauzioniData.cauzioni.map(c => {
                      const statoBadge =
                        c.stato === 'Bloccata' ? 'bg-red-500/20 text-red-400' :
                        c.stato === 'Restituita' ? 'bg-green-500/20 text-green-400' :
                        c.stato === 'Sbloccata' ? 'bg-blue-500/20 text-blue-400' :
                        c.stato === 'Incassata' ? 'bg-yellow-500/20 text-yellow-400' :
                        c.stato === 'Danno' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-theme-bg-hover/20 text-theme-text-muted'
                      return (
                        <tr key={c.id} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                          <td className="px-4 py-3 font-medium text-theme-text-primary">{c.cliente}</td>
                          <td className="px-4 py-3 text-theme-text-primary">
                            <div>{c.veicolo}</div>
                            <div className="text-xs text-theme-text-muted">{c.targa}</div>
                          </td>
                          <td className="text-right px-4 py-3 font-semibold text-theme-text-primary">{formatCurrency(c.importo)}</td>
                          <td className="text-center px-4 py-3 text-theme-text-muted capitalize">{c.metodo}</td>
                          <td className="text-center px-4 py-3">
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statoBadge}`}>
                              {c.stato === 'Bloccata' ? 'Cassa' : c.stato}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-theme-text-muted text-xs max-w-[200px] truncate">{c.note || '—'}</td>
                          <td className="px-4 py-3 text-theme-text-muted text-xs">
                            {new Date(c.updated_at).toLocaleDateString('it-IT')}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Mobile Cards */}
              <div className="md:hidden p-3 space-y-3">
                {cauzioniData.cauzioni.map(c => {
                  const statoBadge =
                    c.stato === 'Bloccata' ? 'bg-red-500/20 text-red-400' :
                    c.stato === 'Restituita' ? 'bg-green-500/20 text-green-400' :
                    c.stato === 'Sbloccata' ? 'bg-blue-500/20 text-blue-400' :
                    c.stato === 'Danno' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-theme-bg-hover/20 text-theme-text-muted'
                  return (
                    <div key={c.id} className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-semibold text-theme-text-primary text-sm">{c.cliente}</p>
                          <p className="text-xs text-theme-text-muted">{c.veicolo} — {c.targa}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statoBadge}`}>
                          {c.stato === 'Bloccata' ? 'Cassa' : c.stato}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div>
                          <p className="font-bold text-theme-text-primary">{formatCurrency(c.importo)}</p>
                          <p className="text-theme-text-muted">Importo</p>
                        </div>
                        <div>
                          <p className="font-bold text-theme-text-primary capitalize">{c.metodo}</p>
                          <p className="text-theme-text-muted">Metodo</p>
                        </div>
                        <div>
                          <p className="font-bold text-theme-text-primary">{new Date(c.updated_at).toLocaleDateString('it-IT')}</p>
                          <p className="text-theme-text-muted">Data</p>
                        </div>
                      </div>
                      {c.note && <p className="text-xs text-theme-text-muted mt-2">{c.note}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
              <p className="text-theme-text-muted">Nessuna cauzione processata per questo mese.</p>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!vehicleData && !washData && !cauzioniData && !loading && !error && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-theme-text-muted text-lg mb-2">Seleziona un mese e genera il report</p>
          <p className="text-theme-text-muted text-sm">I report includono utilizzo veicoli e lavaggi fatturabili</p>
        </div>
      )}
    </div>
  )
}
