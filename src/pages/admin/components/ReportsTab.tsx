import { useState } from 'react'

interface BookingDetail {
  booking_id: string
  targa: string
  start_at: string
  end_at: string
  billable_days: number
  days_in_month: number
  total_price: number
  revenue_per_day: number
}

interface VehicleReport {
  vehicleId: string
  label: string
  plate: string
  category: string
  rentedDays: number
  maintenanceDays: number
  idleDays: number
  utilizationRate: number
  downtimeRate: number
  idleRate: number
  bookingsCount: number
  rentalRevenue: number
  bookings?: BookingDetail[]
}

interface UnmatchedBooking {
  id: string
  vehicle_name: string
  vehicle_plate: string
  vehicle_id: string
}

interface VehicleReportData {
  month: string
  daysInMonth: number
  vehicleCount: number
  totalBookingsFound: number
  unmatchedBookings?: UnmatchedBooking[]
  totalRentalRevenue: number
  avgUtilizationRate: number
  vehicles: VehicleReport[]
}

const CATEGORY_ORDER = ['exotic', 'urban', 'moto', 'utilitaire', '-']
const CATEGORY_LABELS: Record<string, string> = {
  exotic: 'Supercar & Luxury',
  urban: 'Urban',
  moto: 'Moto',
  utilitaire: 'Utilitaire',
  '-': 'Altro'
}
const CATEGORY_COLORS: Record<string, string> = {
  exotic: 'border-yellow-500/50 bg-yellow-500/5',
  urban: 'border-blue-500/50 bg-blue-500/5',
  moto: 'border-purple-500/50 bg-purple-500/5',
  utilitaire: 'border-green-500/50 bg-green-500/5',
  '-': 'border-theme-border/50 bg-theme-bg-hover/5'
}
const CATEGORY_BADGE: Record<string, string> = {
  exotic: 'bg-yellow-500/20 text-yellow-400',
  urban: 'bg-blue-500/20 text-blue-400',
  moto: 'bg-purple-500/20 text-purple-400',
  utilitaire: 'bg-green-500/20 text-green-400',
  '-': 'bg-theme-bg-hover/20 text-theme-text-muted'
}

type SortableField = 'utilizationRate' | 'rentalRevenue' | 'rentedDays'
const SORT_OPTIONS: { value: SortableField; label: string }[] = [
  { value: 'utilizationRate', label: 'Utilizzo' },
  { value: 'rentalRevenue', label: 'Fatturato' },
  { value: 'rentedDays', label: 'Giorni di Noleggio' },
]

export default function ReportsTab() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [vehicleData, setVehicleData] = useState<VehicleReportData | null>(null)

  const [plateSearch, setPlateSearch] = useState('')
  const [sortField, setSortField] = useState<keyof VehicleReport>('utilizationRate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/.netlify/functions/monthly-report?type=vehicles&month=${selectedMonth}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel caricamento')
      setVehicleData(data)
    } catch (err: any) {
      setError(err.message || 'Errore sconosciuto')
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

  function handleDropdownSort(field: SortableField) {
    setSortField(field)
    setSortDir('desc')
  }

  const filteredVehicles = vehicleData?.vehicles
    ? vehicleData.vehicles.filter(v => {
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
    const totalRevenue = vehicles.reduce((s, v) => s + v.rentalRevenue, 0)
    const avgUtil = vehicles.length > 0
      ? vehicles.reduce((s, v) => s + v.utilizationRate, 0) / vehicles.length
      : 0
    return { totalRented, totalRevenue, avgUtil, count: vehicles.length }
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
        Ricavo {sortField === 'rentalRevenue' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
    </tr>
  )

  // Mobile card view for a vehicle
  function renderVehicleCard(v: VehicleReport) {
    return (
      <div key={v.vehicleId} className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border">
        {/* Header with name and plate */}
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="font-semibold text-theme-text-primary text-sm">{v.label}</p>
            <p className="text-xs text-theme-text-muted">{v.plate}</p>
          </div>
          <span className={`text-lg font-bold ${getUtilizationColor(v.utilizationRate)}`}>
            {formatPercent(v.utilizationRate)}
          </span>
        </div>
        {/* Progress bar */}
        <div className="w-full h-2 bg-theme-bg-tertiary rounded-full mb-3">
          <div
            className={`h-full rounded-full ${v.utilizationRate >= 0.7 ? 'bg-green-400' : v.utilizationRate >= 0.4 ? 'bg-yellow-400' : 'bg-red-400'}`}
            style={{ width: `${Math.round(v.utilizationRate * 100)}%` }}
          />
        </div>
        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
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
          <div>
            <p className="text-dr7-gold font-bold">{formatCurrency(v.rentalRevenue)}</p>
            <p className="text-theme-text-muted">Ricavo</p>
          </div>
        </div>
      </div>
    )
  }

  // Desktop table row for a vehicle
  function renderVehicleRow(v: VehicleReport) {
    return (
      <tr key={v.vehicleId} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
        <td className="px-4 py-3 font-medium text-theme-text-primary">{v.label}</td>
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
        <td className="text-right px-4 py-3 text-dr7-gold font-semibold">{formatCurrency(v.rentalRevenue)}</td>
      </tr>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-theme-text-primary">Report Noleggio</h2>
      </div>

      {/* Controls */}
      <div className="bg-theme-bg-secondary/50 backdrop-blur-sm rounded-xl border border-theme-border p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          {/* Month Selector */}
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Mese</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
            />
          </div>

          {/* Sort Dropdown */}
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Ordina per</label>
            <select
              value={sortField as SortableField}
              onChange={(e) => handleDropdownSort(e.target.value as SortableField)}
              className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Generate Button */}
          <button
            onClick={fetchReport}
            disabled={loading}
            className="px-6 py-2 bg-dr7-gold text-black font-semibold rounded-full hover:bg-yellow-500 transition-colors disabled:opacity-50"
          >
            {loading ? 'Caricamento...' : 'Genera Report'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Vehicle Report */}
      {vehicleData && (
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
              <p className="text-xs text-theme-text-muted">Ricavo Totale Noleggi</p>
              <p className="text-2xl font-bold text-dr7-gold">{formatCurrency(vehicleData.totalRentalRevenue)}</p>
            </div>
          </div>

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
            const catColor = CATEGORY_COLORS[group.category] || CATEGORY_COLORS['-']
            const badgeColor = CATEGORY_BADGE[group.category] || CATEGORY_BADGE['-']

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

      {/* Empty state */}
      {!vehicleData && !loading && !error && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-theme-text-muted text-lg mb-2">Seleziona un mese e genera il report</p>
          <p className="text-theme-text-muted text-sm">Il report include utilizzo veicoli e ricavi noleggio</p>
        </div>
      )}
    </div>
  )
}
