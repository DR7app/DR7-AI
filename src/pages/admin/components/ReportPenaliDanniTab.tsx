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

export default function ReportPenaliDanniTab() {
  const [filter, setFilter] = useState<'both' | 'penali' | 'danni'>('both')
  const [penaliData, setPenaliData] = useState<ReportData | null>(null)
  const [danniData, setDanniData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortField, setSortField] = useState<'totalAmount' | 'count'>('totalAmount')

  useEffect(() => {
    fetchReports()
  }, [])

  async function fetchReports() {
    setLoading(true)
    setError('')
    try {
      const [penaliRes, danniRes] = await Promise.all([
        fetch('/.netlify/functions/report-danni?type=penali'),
        fetch('/.netlify/functions/report-danni?type=danni')
      ])
      const [penaliJson, danniJson] = await Promise.all([penaliRes.json(), danniRes.json()])
      if (!penaliRes.ok) throw new Error(penaliJson.error || 'Errore penali')
      if (!danniRes.ok) throw new Error(danniJson.error || 'Errore danni')
      setPenaliData(penaliJson)
      setDanniData(danniJson)
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      setError(_errMsg || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  // Merge data based on filter
  const mergedEntries: (VehicleEntry & { type: 'penali' | 'danni' })[] = []
  if (filter !== 'danni' && penaliData?.vehicles) {
    penaliData.vehicles.forEach(v => mergedEntries.push({ ...v, type: 'penali' }))
  }
  if (filter !== 'penali' && danniData?.vehicles) {
    danniData.vehicles.forEach(v => mergedEntries.push({ ...v, type: 'danni' }))
  }

  const sorted = [...mergedEntries].sort((a, b) => {
    if (sortField === 'totalAmount') return b.totalAmount - a.totalAmount
    return b.count - a.count
  })

  // Summary stats
  const totalCount = sorted.reduce((s, v) => s + v.count, 0)
  const totalAmount = sorted.reduce((s, v) => s + v.totalAmount, 0)
  const penaliCount = penaliData?.totalCount || 0
  const penaliAmount = penaliData?.totalAmount || 0
  const danniCount = danniData?.totalCount || 0
  const danniAmount = danniData?.totalAmount || 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-theme-text-primary">Report Penali & Danni</h2>
        <button
          onClick={fetchReports}
          disabled={loading}
          className="px-4 py-2 rounded-full text-sm font-medium bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover border border-theme-border transition-colors disabled:opacity-50"
        >
          {loading ? 'Caricamento...' : 'Aggiorna'}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['both', 'penali', 'danni'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
              filter === f
                ? 'bg-dr7-gold text-white'
                : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
            }`}
          >
            {f === 'both' ? 'Tutti' : f === 'penali' ? 'Solo Penali' : 'Solo Danni'}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {loading && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
          <p className="text-theme-text-muted">Caricamento...</p>
        </div>
      )}

      {!loading && (penaliData || danniData) && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Penali</p>
              <p className="text-2xl font-bold text-orange-400">{penaliCount}</p>
              <p className="text-sm text-dr7-gold font-semibold">{formatCurrency(penaliAmount)}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Danni</p>
              <p className="text-2xl font-bold text-red-400">{danniCount}</p>
              <p className="text-sm text-dr7-gold font-semibold">{formatCurrency(danniAmount)}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Totale Voci</p>
              <p className="text-2xl font-bold text-theme-text-primary">{penaliCount + danniCount}</p>
            </div>
            <div className="bg-dr7-gold/10 rounded-xl border border-dr7-gold/30 p-4">
              <p className="text-xs text-theme-text-muted">Importo Totale</p>
              <p className="text-2xl font-bold text-dr7-gold">{formatCurrency(penaliAmount + danniAmount)}</p>
            </div>
          </div>

          {/* Sort control */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-theme-text-muted">Ordina per:</label>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as 'totalAmount' | 'count')}
              className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
            >
              <option value="totalAmount">Importo totale</option>
              <option value="count">Numero</option>
            </select>
          </div>

          {/* Table */}
          <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                    <th className="text-left px-4 py-3">Tipo</th>
                    <th className="text-left px-4 py-3">Veicolo</th>
                    <th className="text-left px-4 py-3">Targa</th>
                    <th className="text-left px-4 py-3">Cliente</th>
                    <th className="text-center px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => setSortField('count')}>
                      N. {sortField === 'count' && '↓'}
                    </th>
                    <th className="text-right px-4 py-3 cursor-pointer hover:text-theme-text-primary" onClick={() => setSortField('totalAmount')}>
                      Importo {sortField === 'totalAmount' && '↓'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((v, i) => (
                    <tr key={`${v.type}-${v.vehiclePlate}-${i}`} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          v.type === 'penali' ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {v.type === 'penali' ? 'Penale' : 'Danno'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-theme-text-primary">{v.vehicleName}</td>
                      <td className="px-4 py-3 text-theme-text-muted text-xs">{v.vehiclePlate}</td>
                      <td className="px-4 py-3 text-theme-text-primary">{v.customerName}</td>
                      <td className="text-center px-4 py-3 font-semibold" style={{ color: v.type === 'penali' ? '#fb923c' : '#f87171' }}>{v.count}</td>
                      <td className="text-right px-4 py-3 text-dr7-gold font-semibold">{formatCurrency(v.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-dr7-gold/30 bg-theme-bg-primary/30">
                    <td className="px-4 py-3 font-bold text-theme-text-primary" colSpan={4}>Totale</td>
                    <td className="text-center px-4 py-3 font-bold text-theme-text-primary">{totalCount}</td>
                    <td className="text-right px-4 py-3 font-bold text-dr7-gold">{formatCurrency(totalAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden p-3 space-y-3">
              {sorted.map((v, i) => (
                <div key={`${v.type}-${v.vehiclePlate}-${i}`} className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-semibold text-theme-text-primary text-sm">{v.vehicleName}</p>
                      <p className="text-xs text-theme-text-muted">{v.vehiclePlate}</p>
                      <p className="text-xs text-theme-text-primary mt-1">{v.customerName}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      v.type === 'penali' ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {v.type === 'penali' ? 'Penale' : 'Danno'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div>
                      <p className="text-lg font-bold" style={{ color: v.type === 'penali' ? '#fb923c' : '#f87171' }}>{v.count}</p>
                      <p className="text-xs text-theme-text-muted">N.</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-dr7-gold">{formatCurrency(v.totalAmount)}</p>
                      <p className="text-xs text-theme-text-muted">Importo</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {sorted.length === 0 && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
              <p className="text-theme-text-muted">Nessuna penale o danno registrato.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
