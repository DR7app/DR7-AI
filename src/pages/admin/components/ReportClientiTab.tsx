import { useState } from 'react'

interface CustomerReport {
  customerId: string
  name: string
  email: string
  totalSpend: number
  supercarCount: number
  urbanCount: number
  aziendaliCount: number
  rentalCount: number
  carWashCount: number
  mechanicalCount: number
  totalCount: number
  totalRentalDays: number
  avgDailyRate: number
}

interface CustomerReportData {
  totalCustomers: number
  totalRevenue: number
  totalBookings: number
  totalRentals: number
  totalSupercar: number
  totalUrban: number
  totalAziendali: number
  totalCarWashes: number
  totalMechanical: number
  customers: CustomerReport[]
}

type SortField = 'totalSpend' | 'totalCount' | 'supercarCount' | 'urbanCount' | 'aziendaliCount' | 'carWashCount' | 'mechanicalCount' | 'totalRentalDays' | 'avgDailyRate'

function formatCurrency(amount: number): string {
  return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ReportClientiTab() {
  const [clientiData, setClientiData] = useState<CustomerReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('totalSpend')
  const [sortAsc, setSortAsc] = useState(false)

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  async function fetchClienti() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/.netlify/functions/report-clienti')
      const data = await res.json()
      if (!res.ok) throw new Error(data.details || data.error || 'Errore nel caricamento')
      setClientiData(data)
    } catch (err: any) {
      setError(err.message || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  const filteredClienti = clientiData?.customers
    ? clientiData.customers.filter(c => {
        if (!search.trim()) return true
        const q = search.trim().toLowerCase()
        return (c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
      })
    : []

  const sortedClienti = [...filteredClienti].sort((a, b) => sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-theme-text-primary">Report Clienti</h2>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
        <button
          onClick={fetchClienti}
          disabled={loading}
          className="px-6 py-2 bg-dr7-gold text-black font-semibold rounded-full hover:bg-yellow-500 transition-colors disabled:opacity-50"
        >
          {loading ? 'Caricamento...' : 'Genera Report'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {clientiData && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Clienti Totali</p>
              <p className="text-2xl font-bold text-theme-text-primary">{clientiData.totalCustomers}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Ricavo Totale</p>
              <p className="text-2xl font-bold text-dr7-gold">{formatCurrency(clientiData.totalRevenue)}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Prenotazioni Totali</p>
              <p className="text-2xl font-bold text-theme-text-primary">{clientiData.totalBookings}</p>
              <p className="text-xs text-theme-text-muted mt-1">
                {clientiData.totalSupercar} supercar, {clientiData.totalUrban} urban, {clientiData.totalAziendali} aziendali, {clientiData.totalCarWashes} lavaggi, {clientiData.totalMechanical} meccanica
              </p>
            </div>
          </div>

          {/* Search + Sort */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <input
              type="text"
              placeholder="Cerca per nome o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-4 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm placeholder-theme-text-muted w-full max-w-xs"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-theme-text-muted">Ordina per:</label>
              <select
                value={sortField}
                onChange={(e) => { setSortField(e.target.value as SortField); setSortAsc(false) }}
                className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
              >
                <option value="totalSpend">Spesa totale</option>
                <option value="totalCount">Totale prenotazioni</option>
                <option value="supercarCount">N. Supercar</option>
                <option value="urbanCount">N. Urban</option>
                <option value="aziendaliCount">N. Aziendali</option>
                <option value="carWashCount">N. Lavaggi</option>
                <option value="mechanicalCount">N. Meccanica</option>
                <option value="totalRentalDays">Giorni noleggio</option>
                <option value="avgDailyRate">Tariffa media</option>
              </select>
            </div>
            {search && (
              <span className="text-xs text-theme-text-muted">
                {filteredClienti.length} di {clientiData.totalCustomers} clienti
              </span>
            )}
          </div>

          {/* Desktop Table */}
          <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                    <th className="text-left px-3 py-3">Nome</th>
                    <th className="text-left px-3 py-3">Email</th>
                    <th className="text-right px-3 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('totalSpend')}>
                      Spesa {sortField === 'totalSpend' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="text-center px-2 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('supercarCount')}>
                      Supercar {sortField === 'supercarCount' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="text-center px-2 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('urbanCount')}>
                      Urban {sortField === 'urbanCount' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="text-center px-2 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('aziendaliCount')}>
                      Aziendali {sortField === 'aziendaliCount' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="text-center px-2 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('carWashCount')}>
                      Lavaggi {sortField === 'carWashCount' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="text-center px-2 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('mechanicalCount')}>
                      Meccanica {sortField === 'mechanicalCount' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="text-center px-2 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('totalRentalDays')}>
                      Giorni {sortField === 'totalRentalDays' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="text-right px-3 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => handleSort('avgDailyRate')}>
                      Tariffa {sortField === 'avgDailyRate' && (sortAsc ? '↑' : '↓')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedClienti.map((c, i) => (
                    <tr key={c.customerId || i} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                      <td className="px-3 py-3 font-medium text-theme-text-primary">{c.name}</td>
                      <td className="px-3 py-3 text-theme-text-muted text-xs">{c.email}</td>
                      <td className="text-right px-3 py-3 text-dr7-gold font-semibold">{formatCurrency(c.totalSpend)}</td>
                      <td className="text-center px-2 py-3 text-theme-text-primary">{c.supercarCount || '-'}</td>
                      <td className="text-center px-2 py-3 text-theme-text-primary">{c.urbanCount || '-'}</td>
                      <td className="text-center px-2 py-3 text-theme-text-primary">{c.aziendaliCount || '-'}</td>
                      <td className="text-center px-2 py-3 text-theme-text-primary">{c.carWashCount || '-'}</td>
                      <td className="text-center px-2 py-3 text-theme-text-primary">{c.mechanicalCount || '-'}</td>
                      <td className="text-center px-2 py-3 text-theme-text-primary">{c.totalRentalDays}</td>
                      <td className="text-right px-3 py-3 text-theme-text-muted">{formatCurrency(c.avgDailyRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile Cards */}
            <div className="md:hidden p-3 space-y-3">
              {sortedClienti.map((c, i) => (
                <div key={c.customerId || i} className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border">
                  <div className="mb-2">
                    <p className="font-semibold text-theme-text-primary text-sm">{c.name}</p>
                    <p className="text-xs text-theme-text-muted">{c.email}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-base font-bold text-dr7-gold">{formatCurrency(c.totalSpend)}</p>
                      <p className="text-[10px] text-theme-text-muted">Spesa</p>
                    </div>
                    <div>
                      <p className="text-base font-bold text-theme-text-primary">{c.supercarCount}</p>
                      <p className="text-[10px] text-theme-text-muted">Supercar</p>
                    </div>
                    <div>
                      <p className="text-base font-bold text-theme-text-primary">{c.urbanCount}</p>
                      <p className="text-[10px] text-theme-text-muted">Urban</p>
                    </div>
                    <div>
                      <p className="text-base font-bold text-theme-text-primary">{c.aziendaliCount}</p>
                      <p className="text-[10px] text-theme-text-muted">Aziendali</p>
                    </div>
                    <div>
                      <p className="text-base font-bold text-theme-text-primary">{c.carWashCount}</p>
                      <p className="text-[10px] text-theme-text-muted">Lavaggi</p>
                    </div>
                    <div>
                      <p className="text-base font-bold text-theme-text-primary">{c.mechanicalCount}</p>
                      <p className="text-[10px] text-theme-text-muted">Meccanica</p>
                    </div>
                    <div>
                      <p className="text-base font-bold text-theme-text-primary">{c.totalRentalDays}</p>
                      <p className="text-[10px] text-theme-text-muted">Giorni</p>
                    </div>
                    <div>
                      <p className="text-base font-bold text-theme-text-muted">{formatCurrency(c.avgDailyRate)}</p>
                      <p className="text-[10px] text-theme-text-muted">Tariffa</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {sortedClienti.length === 0 && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
              <p className="text-theme-text-muted">Nessun cliente trovato.</p>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!clientiData && !loading && !error && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-theme-text-muted text-lg mb-2">Clicca "Genera Report" per visualizzare i dati</p>
          <p className="text-theme-text-muted text-sm">Il report include supercar, urban, aziendali, lavaggi e meccanica per cliente</p>
        </div>
      )}
    </div>
  )
}
