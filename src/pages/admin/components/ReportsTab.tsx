import { useState } from 'react'

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

interface WashTypeBreakdown {
  type: string
  count: number
  revenue: number
}

interface WashReportData {
  month: string
  daysInMonth: number
  billableWashesCount: number
  washRevenue: number
  avgWashesPerDay: number
  byType: WashTypeBreakdown[]
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
  '-': 'border-gray-500/50 bg-gray-500/5'
}
const CATEGORY_BADGE: Record<string, string> = {
  exotic: 'bg-yellow-500/20 text-yellow-400',
  urban: 'bg-blue-500/20 text-blue-400',
  moto: 'bg-purple-500/20 text-purple-400',
  utilitaire: 'bg-green-500/20 text-green-400',
  '-': 'bg-gray-500/20 text-gray-400'
}

export default function ReportsTab() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [activeReport, setActiveReport] = useState<'vehicles' | 'washes'>('vehicles')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [vehicleData, setVehicleData] = useState<VehicleReportData | null>(null)
  const [washData, setWashData] = useState<WashReportData | null>(null)

  const [plateSearch, setPlateSearch] = useState('')
  const [sortField, setSortField] = useState<keyof VehicleReport>('utilizationRate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/.netlify/functions/monthly-report?type=${activeReport}&month=${selectedMonth}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel caricamento')
      if (activeReport === 'vehicles') {
        setVehicleData(data)
      } else {
        setWashData(data)
      }
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
    <tr className="bg-gray-900/50 text-theme-text-muted">
      <th className="text-left px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('label')}>
        Veicolo {sortField === 'label' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-left px-4 py-3">Targa</th>
      <th className="text-center px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('rentedDays')}>
        Noleggiato {sortField === 'rentedDays' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-center px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('maintenanceDays')}>
        Manut. {sortField === 'maintenanceDays' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-center px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('idleDays')}>
        Fermo {sortField === 'idleDays' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-center px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('utilizationRate')}>
        Utilizzo {sortField === 'utilizationRate' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-center px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('bookingsCount')}>
        Pren. {sortField === 'bookingsCount' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
      <th className="text-right px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('rentalRevenue')}>
        Ricavo {sortField === 'rentalRevenue' && (sortDir === 'asc' ? '↑' : '↓')}
      </th>
    </tr>
  )

  function renderVehicleRow(v: VehicleReport) {
    return (
      <tr key={v.vehicleId} className="border-t border-theme-border hover:bg-gray-700/30 transition-colors">
        <td className="px-4 py-3 font-medium text-theme-text-primary">{v.label}</td>
        <td className="px-4 py-3 text-theme-text-muted text-xs">{v.plate}</td>
        <td className="text-center px-4 py-3">
          <span className="text-green-400 font-semibold">{v.rentedDays}g</span>
        </td>
        <td className="text-center px-4 py-3">
          <span className="text-orange-400 font-semibold">{v.maintenanceDays}g</span>
        </td>
        <td className="text-center px-4 py-3">
          <span className="text-gray-400">{v.idleDays}g</span>
        </td>
        <td className="text-center px-4 py-3">
          <span className={`font-bold ${getUtilizationColor(v.utilizationRate)}`}>
            {formatPercent(v.utilizationRate)}
          </span>
          <div className="w-full h-1.5 bg-gray-700 rounded-full mt-1">
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
        <h2 className="text-2xl font-bold text-theme-text-primary">Report Mensili</h2>
      </div>

      {/* Controls */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-theme-border p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          {/* Report Type Toggle */}
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Tipo Report</label>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveReport('vehicles')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                  activeReport === 'vehicles'
                    ? 'bg-dr7-gold text-black border-dr7-gold'
                    : 'bg-transparent text-white border-white hover:bg-white hover:text-black'
                }`}
              >
                Veicoli
              </button>
              <button
                onClick={() => setActiveReport('washes')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                  activeReport === 'washes'
                    ? 'bg-dr7-gold text-black border-dr7-gold'
                    : 'bg-transparent text-white border-white hover:bg-white hover:text-black'
                }`}
              >
                Lavaggi
              </button>
            </div>
          </div>

          {/* Month Selector */}
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Mese</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 bg-gray-700 border border-theme-border-light rounded text-theme-text-primary text-sm"
            />
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
      {activeReport === 'vehicles' && vehicleData && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-gray-800/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Veicoli Attivi</p>
              <p className="text-2xl font-bold text-theme-text-primary">{vehicleData.vehicleCount}</p>
            </div>
            <div className="bg-gray-800/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Prenotazioni Trovate</p>
              <p className="text-2xl font-bold text-theme-text-primary">{vehicleData.totalBookingsFound}</p>
            </div>
            <div className="bg-gray-800/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Giorni nel Mese</p>
              <p className="text-2xl font-bold text-theme-text-primary">{vehicleData.daysInMonth}</p>
            </div>
            <div className="bg-gray-800/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Utilizzo Medio</p>
              <p className={`text-2xl font-bold ${getUtilizationColor(vehicleData.avgUtilizationRate)}`}>
                {formatPercent(vehicleData.avgUtilizationRate)}
              </p>
            </div>
            <div className="bg-gray-800/50 rounded-xl border border-theme-border p-4">
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
              className="px-4 py-2 bg-gray-700 border border-theme-border-light rounded-lg text-theme-text-primary text-sm placeholder-gray-500 w-full max-w-xs"
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
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-theme-text-muted">
                      Utilizzo medio: <span className={`font-bold ${getUtilizationColor(summary.avgUtil)}`}>{formatPercent(summary.avgUtil)}</span>
                    </span>
                    <span className="text-theme-text-muted">
                      Ricavo: <span className="font-bold text-dr7-gold">{formatCurrency(summary.totalRevenue)}</span>
                    </span>
                  </div>
                </div>
                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>{tableHeader}</thead>
                    <tbody>
                      {group.vehicles.map(v => renderVehicleRow(v))}
                    </tbody>
                  </table>
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
            <div className="bg-gray-800/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Lavaggi Fatturabili</p>
              <p className="text-2xl font-bold text-theme-text-primary">{washData.billableWashesCount}</p>
            </div>
            <div className="bg-gray-800/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Ricavo Lavaggi</p>
              <p className="text-2xl font-bold text-dr7-gold">{formatCurrency(washData.washRevenue)}</p>
            </div>
            <div className="bg-gray-800/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Media Lavaggi / Giorno</p>
              <p className="text-2xl font-bold text-theme-text-primary">{washData.avgWashesPerDay}</p>
            </div>
          </div>

          {/* Breakdown by Type */}
          {washData.byType.length > 0 && (
            <div className="bg-gray-800/50 rounded-xl border border-theme-border overflow-hidden">
              <div className="px-4 py-3 border-b border-theme-border">
                <h3 className="text-sm font-semibold text-theme-text-primary">Dettaglio per Tipo di Servizio</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-900/50 text-theme-text-muted">
                      <th className="text-left px-4 py-3">Servizio</th>
                      <th className="text-center px-4 py-3">Quantità</th>
                      <th className="text-right px-4 py-3">Ricavo</th>
                      <th className="text-right px-4 py-3">% del Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {washData.byType.map(item => (
                      <tr key={item.type} className="border-t border-theme-border hover:bg-gray-700/30 transition-colors">
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
                    <tr className="border-t-2 border-dr7-gold/30 bg-gray-900/30">
                      <td className="px-4 py-3 font-bold text-theme-text-primary">Totale</td>
                      <td className="text-center px-4 py-3 font-bold text-theme-text-primary">{washData.billableWashesCount}</td>
                      <td className="text-right px-4 py-3 font-bold text-dr7-gold">{formatCurrency(washData.washRevenue)}</td>
                      <td className="text-right px-4 py-3 font-bold text-theme-text-muted">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {washData.byType.length === 0 && (
            <div className="bg-gray-800/50 rounded-xl border border-theme-border p-8 text-center">
              <p className="text-theme-text-muted">Nessun lavaggio fatturabile trovato per questo mese.</p>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!vehicleData && !washData && !loading && !error && (
        <div className="bg-gray-800/50 rounded-xl border border-theme-border p-12 text-center">
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
