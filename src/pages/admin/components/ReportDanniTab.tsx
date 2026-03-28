import { useState, useEffect } from 'react'

interface VehicleEntry {
  vehicleName: string
  vehiclePlate: string
  customerName: string
  count: number
  totalAmount: number
}

interface ReportData {
  type: string
  totalVehicles: number
  totalCount: number
  totalAmount: number
  vehicles: VehicleEntry[]
}

function formatCurrency(amount: number): string {
  return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ReportDanniTab() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortField, setSortField] = useState<'totalAmount' | 'count'>('totalAmount')

  useEffect(() => {
    fetchReport()
  }, [])

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/.netlify/functions/report-danni?type=danni')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Errore nel caricamento')
      setData(json)
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      setError(_errMsg || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  const sorted = data?.vehicles
    ? [...data.vehicles].sort((a, b) => {
        if (sortField === 'totalAmount') return b.totalAmount - a.totalAmount
        return b.count - a.count
      })
    : []

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-theme-text-primary">Report Danni</h2>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {loading && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
          <p className="text-theme-text-muted">Caricamento...</p>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Veicoli con Danni</p>
              <p className="text-2xl font-bold text-theme-text-primary">{data.totalVehicles}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Totale Danni</p>
              <p className="text-2xl font-bold text-red-400">{data.totalCount}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Importo Totale</p>
              <p className="text-2xl font-bold text-dr7-gold">{formatCurrency(data.totalAmount)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-theme-text-muted">Ordina per:</label>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as 'totalAmount' | 'count')}
              className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
            >
              <option value="totalAmount">Importo totale</option>
              <option value="count">N. Danni</option>
            </select>
          </div>

          <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                    <th className="text-left px-4 py-3">Veicolo</th>
                    <th className="text-left px-4 py-3">Targa</th>
                    <th className="text-left px-4 py-3">Cliente</th>
                    <th className="text-center px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => setSortField('count')}>
                      N. Danni {sortField === 'count' && '↓'}
                    </th>
                    <th className="text-right px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => setSortField('totalAmount')}>
                      Importo Totale {sortField === 'totalAmount' && '↓'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((v, i) => (
                    <tr key={v.vehiclePlate || i} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-theme-text-primary">{v.vehicleName}</td>
                      <td className="px-4 py-3 text-theme-text-muted text-xs">{v.vehiclePlate}</td>
                      <td className="px-4 py-3 text-theme-text-primary">{v.customerName}</td>
                      <td className="text-center px-4 py-3 text-red-400 font-semibold">{v.count}</td>
                      <td className="text-right px-4 py-3 text-dr7-gold font-semibold">{formatCurrency(v.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-dr7-gold/30 bg-theme-bg-primary/30">
                    <td className="px-4 py-3 font-bold text-theme-text-primary" colSpan={3}>Totale</td>
                    <td className="text-center px-4 py-3 font-bold text-red-400">{data.totalCount}</td>
                    <td className="text-right px-4 py-3 font-bold text-dr7-gold">{formatCurrency(data.totalAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="md:hidden p-3 space-y-3">
              {sorted.map((v, i) => (
                <div key={v.vehiclePlate || i} className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border">
                  <div className="mb-2">
                    <p className="font-semibold text-theme-text-primary text-sm">{v.vehicleName}</p>
                    <p className="text-xs text-theme-text-muted">{v.vehiclePlate}</p>
                    <p className="text-xs text-theme-text-primary mt-1">{v.customerName}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div>
                      <p className="text-lg font-bold text-red-400">{v.count}</p>
                      <p className="text-xs text-theme-text-muted">Danni</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-dr7-gold">{formatCurrency(v.totalAmount)}</p>
                      <p className="text-xs text-theme-text-muted">Importo</p>
                    </div>
                  </div>
                </div>
              ))}
              <div className="bg-dr7-gold/10 rounded-lg p-4 border border-dr7-gold/30">
                <p className="font-bold text-theme-text-primary text-sm mb-2">Totale</p>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold text-red-400">{data.totalCount}</p>
                    <p className="text-xs text-theme-text-muted">Danni</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-dr7-gold">{formatCurrency(data.totalAmount)}</p>
                    <p className="text-xs text-theme-text-muted">Importo</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {sorted.length === 0 && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
              <p className="text-theme-text-muted">Nessun danno registrato.</p>
            </div>
          )}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-theme-text-muted text-lg mb-2">Caricamento report danni...</p>
        </div>
      )}
    </div>
  )
}
