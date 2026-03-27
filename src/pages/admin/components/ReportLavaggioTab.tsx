import { useState } from 'react'

interface WashTypeBreakdown {
  type: string
  count: number
  revenue: number
}

interface InternalWashBreakdown {
  vehicle: string
  count: number
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

function formatCurrency(amount: number): string {
  return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ReportLavaggioTab() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [washData, setWashData] = useState<WashReportData | null>(null)

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/.netlify/functions/monthly-report?type=washes&month=${selectedMonth}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel caricamento')
      setWashData(data)
    } catch (err: any) {
      setError(err.message || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-theme-text-primary">Report Lavaggio</h2>
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

          {/* Generate Button */}
          <button
            onClick={fetchReport}
            disabled={loading}
            className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#247a6f] transition-colors disabled:opacity-50"
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

      {/* Wash Report */}
      {washData && (
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
                      <th className="text-center px-4 py-3">Quantita</th>
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
                        <p className="text-xs text-theme-text-muted">Quantita</p>
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
                      <th className="text-center px-4 py-3">Quantita</th>
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

      {/* Empty state */}
      {!washData && !loading && !error && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-theme-text-muted text-lg mb-2">Seleziona un mese e genera il report</p>
          <p className="text-theme-text-muted text-sm">Il report include lavaggi fatturabili e lavaggi rientro interni</p>
        </div>
      )}
    </div>
  )
}
