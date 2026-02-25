import { useState, useEffect } from 'react'

interface CustomerReport {
  customerId: string
  name: string
  email: string
  totalSpend: number
  bookingsCount: number
}

interface CustomerReportData {
  totalCustomers: number
  totalRevenue: number
  totalBookings: number
  customers: CustomerReport[]
}

interface DanniVehicle {
  vehicleName: string
  vehiclePlate: string
  penaltyCount: number
  totalAmount: number
}

interface DanniReportData {
  totalVehiclesWithDamages: number
  totalDamages: number
  totalAmount: number
  vehicles: DanniVehicle[]
}

function formatCurrency(amount: number): string {
  return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ReportClientiTab() {
  const [activeSubTab, setActiveSubTab] = useState<'clienti' | 'danni'>('clienti')

  // Clienti state
  const [clientiData, setClientiData] = useState<CustomerReportData | null>(null)
  const [clientiLoading, setClientiLoading] = useState(false)
  const [clientiError, setClientiError] = useState('')
  const [clientiSearch, setClientiSearch] = useState('')
  const [clientiSort, setClientiSort] = useState<'totalSpend' | 'bookingsCount'>('totalSpend')

  // Danni state
  const [danniData, setDanniData] = useState<DanniReportData | null>(null)
  const [danniLoading, setDanniLoading] = useState(false)
  const [danniError, setDanniError] = useState('')
  const [danniSort, setDanniSort] = useState<'totalAmount' | 'penaltyCount'>('totalAmount')

  // Auto-fetch danni on first switch
  const [danniFetched, setDanniFetched] = useState(false)
  useEffect(() => {
    if (activeSubTab === 'danni' && !danniFetched) {
      fetchDanni()
      setDanniFetched(true)
    }
  }, [activeSubTab, danniFetched])

  async function fetchClienti() {
    setClientiLoading(true)
    setClientiError('')
    try {
      const res = await fetch('/.netlify/functions/report-clienti')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel caricamento')
      setClientiData(data)
    } catch (err: any) {
      setClientiError(err.message || 'Errore sconosciuto')
    } finally {
      setClientiLoading(false)
    }
  }

  async function fetchDanni() {
    setDanniLoading(true)
    setDanniError('')
    try {
      const res = await fetch('/.netlify/functions/report-danni')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel caricamento')
      setDanniData(data)
    } catch (err: any) {
      setDanniError(err.message || 'Errore sconosciuto')
    } finally {
      setDanniLoading(false)
    }
  }

  // Filtered and sorted clienti
  const filteredClienti = clientiData?.customers
    ? clientiData.customers.filter(c => {
        if (!clientiSearch.trim()) return true
        const q = clientiSearch.trim().toLowerCase()
        return (c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
      })
    : []

  const sortedClienti = [...filteredClienti].sort((a, b) => {
    if (clientiSort === 'totalSpend') return b.totalSpend - a.totalSpend
    return b.bookingsCount - a.bookingsCount
  })

  // Sorted danni
  const sortedDanni = danniData?.vehicles
    ? [...danniData.vehicles].sort((a, b) => {
        if (danniSort === 'totalAmount') return b.totalAmount - a.totalAmount
        return b.penaltyCount - a.penaltyCount
      })
    : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-theme-text-primary">Report Clienti</h2>
      </div>

      {/* Subtab Toggle */}
      <div className="bg-theme-bg-secondary/50 backdrop-blur-sm rounded-xl border border-theme-border p-4">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveSubTab('clienti')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
              activeSubTab === 'clienti'
                ? 'bg-dr7-gold text-black border-dr7-gold'
                : 'bg-transparent text-theme-text-primary border-theme-text-primary hover:bg-theme-text-primary hover:text-theme-bg-primary'
            }`}
          >
            Clienti
          </button>
          <button
            onClick={() => setActiveSubTab('danni')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
              activeSubTab === 'danni'
                ? 'bg-dr7-gold text-black border-dr7-gold'
                : 'bg-transparent text-theme-text-primary border-theme-text-primary hover:bg-theme-text-primary hover:text-theme-bg-primary'
            }`}
          >
            Danni
          </button>
        </div>
      </div>

      {/* ============ CLIENTI SUBTAB ============ */}
      {activeSubTab === 'clienti' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
            <button
              onClick={fetchClienti}
              disabled={clientiLoading}
              className="px-6 py-2 bg-dr7-gold text-black font-semibold rounded-full hover:bg-yellow-500 transition-colors disabled:opacity-50"
            >
              {clientiLoading ? 'Caricamento...' : 'Genera Report'}
            </button>
          </div>

          {clientiError && (
            <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
              {clientiError}
            </div>
          )}

          {clientiData && (
            <>
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
                </div>
              </div>

              {/* Search + Sort */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <input
                  type="text"
                  placeholder="Cerca per nome o email..."
                  value={clientiSearch}
                  onChange={(e) => setClientiSearch(e.target.value)}
                  className="px-4 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm placeholder-theme-text-muted w-full max-w-xs"
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-theme-text-muted">Ordina per:</label>
                  <select
                    value={clientiSort}
                    onChange={(e) => setClientiSort(e.target.value as 'totalSpend' | 'bookingsCount')}
                    className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
                  >
                    <option value="totalSpend">Spesa totale</option>
                    <option value="bookingsCount">N. Prenotazioni</option>
                  </select>
                </div>
                {clientiSearch && (
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
                        <th className="text-left px-4 py-3">Nome</th>
                        <th className="text-left px-4 py-3">Email</th>
                        <th className="text-right px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => setClientiSort('totalSpend')}>
                          Spesa Totale {clientiSort === 'totalSpend' && '↓'}
                        </th>
                        <th className="text-center px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => setClientiSort('bookingsCount')}>
                          N. Prenotazioni {clientiSort === 'bookingsCount' && '↓'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedClienti.map((c, i) => (
                        <tr key={c.customerId || i} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                          <td className="px-4 py-3 font-medium text-theme-text-primary">{c.name}</td>
                          <td className="px-4 py-3 text-theme-text-muted text-xs">{c.email}</td>
                          <td className="text-right px-4 py-3 text-dr7-gold font-semibold">{formatCurrency(c.totalSpend)}</td>
                          <td className="text-center px-4 py-3 text-theme-text-primary">{c.bookingsCount}</td>
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
                      <div className="grid grid-cols-2 gap-3 text-center">
                        <div>
                          <p className="text-lg font-bold text-dr7-gold">{formatCurrency(c.totalSpend)}</p>
                          <p className="text-xs text-theme-text-muted">Spesa</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-theme-text-primary">{c.bookingsCount}</p>
                          <p className="text-xs text-theme-text-muted">Prenotazioni</p>
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
            </>
          )}

          {/* Empty state */}
          {!clientiData && !clientiLoading && !clientiError && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
              <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-theme-text-muted text-lg mb-2">Clicca "Genera Report" per visualizzare i dati</p>
              <p className="text-theme-text-muted text-sm">Il report include spesa totale e numero prenotazioni per cliente</p>
            </div>
          )}
        </div>
      )}

      {/* ============ DANNI SUBTAB ============ */}
      {activeSubTab === 'danni' && (
        <div className="space-y-4">
          {danniError && (
            <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
              {danniError}
            </div>
          )}

          {danniLoading && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
              <p className="text-theme-text-muted">Caricamento...</p>
            </div>
          )}

          {danniData && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
                  <p className="text-xs text-theme-text-muted">Veicoli con Danni</p>
                  <p className="text-2xl font-bold text-theme-text-primary">{danniData.totalVehiclesWithDamages}</p>
                </div>
                <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
                  <p className="text-xs text-theme-text-muted">Totale Danni</p>
                  <p className="text-2xl font-bold text-red-400">{danniData.totalDamages}</p>
                </div>
                <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
                  <p className="text-xs text-theme-text-muted">Importo Totale</p>
                  <p className="text-2xl font-bold text-dr7-gold">{formatCurrency(danniData.totalAmount)}</p>
                </div>
              </div>

              {/* Sort */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-theme-text-muted">Ordina per:</label>
                <select
                  value={danniSort}
                  onChange={(e) => setDanniSort(e.target.value as 'totalAmount' | 'penaltyCount')}
                  className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
                >
                  <option value="totalAmount">Importo totale</option>
                  <option value="penaltyCount">N. Danni</option>
                </select>
              </div>

              {/* Desktop Table */}
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                        <th className="text-left px-4 py-3">Veicolo</th>
                        <th className="text-left px-4 py-3">Targa</th>
                        <th className="text-center px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => setDanniSort('penaltyCount')}>
                          N. Danni {danniSort === 'penaltyCount' && '↓'}
                        </th>
                        <th className="text-right px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => setDanniSort('totalAmount')}>
                          Importo Totale {danniSort === 'totalAmount' && '↓'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedDanni.map((v, i) => (
                        <tr key={v.vehiclePlate || i} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                          <td className="px-4 py-3 font-medium text-theme-text-primary">{v.vehicleName}</td>
                          <td className="px-4 py-3 text-theme-text-muted text-xs">{v.vehiclePlate}</td>
                          <td className="text-center px-4 py-3 text-red-400 font-semibold">{v.penaltyCount}</td>
                          <td className="text-right px-4 py-3 text-dr7-gold font-semibold">{formatCurrency(v.totalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-dr7-gold/30 bg-theme-bg-primary/30">
                        <td className="px-4 py-3 font-bold text-theme-text-primary" colSpan={2}>Totale</td>
                        <td className="text-center px-4 py-3 font-bold text-red-400">{danniData.totalDamages}</td>
                        <td className="text-right px-4 py-3 font-bold text-dr7-gold">{formatCurrency(danniData.totalAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {/* Mobile Cards */}
                <div className="md:hidden p-3 space-y-3">
                  {sortedDanni.map((v, i) => (
                    <div key={v.vehiclePlate || i} className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-semibold text-theme-text-primary text-sm">{v.vehicleName}</p>
                          <p className="text-xs text-theme-text-muted">{v.vehiclePlate}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-center">
                        <div>
                          <p className="text-lg font-bold text-red-400">{v.penaltyCount}</p>
                          <p className="text-xs text-theme-text-muted">Danni</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-dr7-gold">{formatCurrency(v.totalAmount)}</p>
                          <p className="text-xs text-theme-text-muted">Importo</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* Mobile Total */}
                  <div className="bg-dr7-gold/10 rounded-lg p-4 border border-dr7-gold/30">
                    <p className="font-bold text-theme-text-primary text-sm mb-2">Totale</p>
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div>
                        <p className="text-lg font-bold text-red-400">{danniData.totalDamages}</p>
                        <p className="text-xs text-theme-text-muted">Danni</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-dr7-gold">{formatCurrency(danniData.totalAmount)}</p>
                        <p className="text-xs text-theme-text-muted">Importo</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {sortedDanni.length === 0 && (
                <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
                  <p className="text-theme-text-muted">Nessun danno registrato.</p>
                </div>
              )}
            </>
          )}

          {/* Empty state when not yet loaded and no error */}
          {!danniData && !danniLoading && !danniError && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
              <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-theme-text-muted text-lg mb-2">Caricamento report danni...</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
