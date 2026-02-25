import { useState, useEffect } from 'react'

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

export default function ReportDanniTab() {
  const [danniData, setDanniData] = useState<DanniReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [danniSort, setDanniSort] = useState<'totalAmount' | 'penaltyCount'>('totalAmount')

  useEffect(() => {
    fetchDanni()
  }, [])

  async function fetchDanni() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/.netlify/functions/report-danni')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel caricamento')
      setDanniData(data)
    } catch (err: any) {
      setError(err.message || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

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
        <h2 className="text-2xl font-bold text-theme-text-primary">Report Penali</h2>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
          <p className="text-theme-text-muted">Caricamento...</p>
        </div>
      )}

      {danniData && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Veicoli con Penali</p>
              <p className="text-2xl font-bold text-theme-text-primary">{danniData.totalVehiclesWithDamages}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Totale Penali</p>
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
              <option value="penaltyCount">N. Penali</option>
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
                      N. Penali {danniSort === 'penaltyCount' && '↓'}
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
                      <p className="text-xs text-theme-text-muted">Penali</p>
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
                    <p className="text-xs text-theme-text-muted">Penali</p>
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
              <p className="text-theme-text-muted">Nessuna penale registrata.</p>
            </div>
          )}
        </div>
      )}

      {/* Empty state when not yet loaded and no error */}
      {!danniData && !loading && !error && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-theme-text-muted text-lg mb-2">Caricamento report penali...</p>
        </div>
      )}
    </div>
  )
}
