import { useState, useEffect, useMemo } from 'react'

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
  return `€ ${amount.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function formatCurrencyDecimal(amount: number): string {
  return `€ ${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function initials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || '?'
}

const AVATAR_COLORS = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-orange-100 text-orange-700',
]
function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export default function ReportDanniTab() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortField, setSortField] = useState<'totalAmount' | 'count'>('totalAmount')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 8

  useEffect(() => { fetchReport() }, [])
  useEffect(() => { setPage(1) }, [sortField])

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/.netlify/functions/report-danni?type=danni')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Errore nel caricamento')
      setData(json)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  const sorted = useMemo(() => {
    if (!data?.vehicles) return []
    return [...data.vehicles].sort((a, b) =>
      sortField === 'totalAmount' ? b.totalAmount - a.totalAmount : b.count - a.count
    )
  }, [data, sortField])

  const topCustomers = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>()
    for (const v of data?.vehicles || []) {
      if (!v.customerName || v.customerName === '-') continue
      const cur = map.get(v.customerName) || { name: v.customerName, total: 0, count: 0 }
      cur.total += v.totalAmount
      cur.count += v.count
      map.set(v.customerName, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 5)
  }, [data])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const avgPerVehicle = data && data.totalVehicles > 0 ? data.totalAmount / data.totalVehicles : 0

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary tracking-tight">Report Danni</h2>
          <p className="text-sm text-theme-text-secondary mt-0.5">Riepilogo dei danni registrati per veicolo</p>
        </div>
        <button
          onClick={fetchReport}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white text-theme-text-primary text-sm font-semibold rounded-full border border-theme-border hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          {loading ? 'Aggiorno…' : 'Aggiorna'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard
              label="Veicoli con Danni"
              value={`${data.totalVehicles}`}
              sub="parco coinvolto"
              accent="amber"
            />
            <KpiCard
              label="Danni Registrati"
              value={`${data.totalCount}`}
              sub={`${data.totalCount === 1 ? 'caso' : 'casi'}`}
              accent="rose"
            />
            <KpiCard
              label="Importo Totale"
              value={formatCurrency(data.totalAmount)}
              sub={`${formatCurrency(avgPerVehicle)} medio`}
              accent="gold"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-sm font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              Danni
              <span className="text-xs text-rose-600/70">{data.totalCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-theme-text-muted">Ordina per</label>
              <select
                value={sortField}
                onChange={e => setSortField(e.target.value as 'totalAmount' | 'count')}
                className="px-3 py-1.5 bg-theme-bg-primary border border-theme-border rounded-lg text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold"
              >
                <option value="totalAmount">Importo</option>
                <option value="count">Numero</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-theme-bg-primary border border-theme-border rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-theme-border">
                <h3 className="text-base font-semibold text-theme-text-primary">Lista Danni per Veicolo</h3>
                <p className="text-xs text-theme-text-muted">{sorted.length} veicoli</p>
              </div>

              {loading && (
                <div className="px-5 py-12 text-center text-theme-text-muted text-sm">Caricamento…</div>
              )}

              {!loading && sorted.length === 0 && (
                <div className="px-5 py-12 text-center text-theme-text-muted text-sm">Nessun danno registrato.</div>
              )}

              {!loading && sorted.length > 0 && (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-theme-bg-tertiary/40 border-b border-theme-border text-xs uppercase tracking-wide text-theme-text-secondary">
                          <th className="px-5 py-3 text-left font-medium">Veicolo</th>
                          <th className="px-5 py-3 text-left font-medium">Cliente</th>
                          <th className="px-5 py-3 text-center font-medium">N.</th>
                          <th className="px-5 py-3 text-right font-medium">Importo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageItems.map((v, i) => (
                          <tr key={v.vehiclePlate || i} className="border-b border-theme-border last:border-0 hover:bg-theme-bg-hover/40 transition-colors">
                            <td className="px-5 py-3">
                              <div className="font-medium text-theme-text-primary">{v.vehicleName}</div>
                              <div className="text-xs text-theme-text-muted">{v.vehiclePlate}</div>
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold ${avatarColor(v.customerName || v.vehiclePlate)}`}>
                                  {initials(v.customerName)}
                                </span>
                                <span className="text-theme-text-primary">{v.customerName || '—'}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-center font-semibold text-rose-600">{v.count}</td>
                            <td className="px-5 py-3 text-right font-semibold text-dr7-gold">{formatCurrencyDecimal(v.totalAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-theme-bg-tertiary/30 border-t border-theme-border">
                          <td className="px-5 py-3 font-semibold text-theme-text-primary" colSpan={2}>Totale</td>
                          <td className="px-5 py-3 text-center font-bold text-rose-600">{data.totalCount}</td>
                          <td className="px-5 py-3 text-right font-bold text-dr7-gold">{formatCurrencyDecimal(data.totalAmount)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="md:hidden divide-y divide-theme-border">
                    {pageItems.map((v, i) => (
                      <div key={v.vehiclePlate || i} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <div className="font-medium text-theme-text-primary truncate">{v.vehicleName}</div>
                            <div className="text-xs text-theme-text-muted">{v.vehiclePlate}</div>
                            <div className="text-xs text-theme-text-secondary mt-0.5 truncate">{v.customerName || '—'}</div>
                          </div>
                          <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-rose-50 text-rose-700 border-rose-200">
                            {v.count}
                          </span>
                        </div>
                        <div className="text-right font-semibold text-dr7-gold">{formatCurrencyDecimal(v.totalAmount)}</div>
                      </div>
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="px-5 py-3 border-t border-theme-border flex items-center justify-between text-xs text-theme-text-secondary">
                      <span>Mostra {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, sorted.length)} di {sorted.length}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary disabled:opacity-40 hover:bg-theme-bg-hover">‹</button>
                        {Array.from({ length: totalPages }).slice(0, 6).map((_, i) => (
                          <button key={i} onClick={() => setPage(i + 1)} className={`w-7 h-7 rounded text-xs font-medium ${page === i + 1 ? 'bg-dr7-gold text-white' : 'border border-theme-border bg-theme-bg-primary hover:bg-theme-bg-hover'}`}>{i + 1}</button>
                        ))}
                        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary disabled:opacity-40 hover:bg-theme-bg-hover">›</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="space-y-4">
              <div className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Clienti più Coinvolti</h3>
                {topCustomers.length === 0 ? (
                  <p className="text-xs text-theme-text-muted">Nessun cliente registrato.</p>
                ) : (
                  <div className="space-y-1">
                    {topCustomers.map(c => (
                      <div key={c.name} className="flex items-center justify-between gap-3 py-1.5 border-b border-theme-border last:border-0">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold shrink-0 ${avatarColor(c.name)}`}>
                            {initials(c.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm text-theme-text-primary truncate">{c.name}</p>
                            <p className="text-xs text-theme-text-muted">{c.count} {c.count === 1 ? 'danno' : 'danni'}</p>
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-dr7-gold whitespace-nowrap">{formatCurrency(c.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <div className="bg-theme-bg-primary border border-theme-border rounded-2xl p-12 text-center">
          <p className="text-theme-text-muted text-sm">Caricamento report danni…</p>
        </div>
      )}
    </div>
  )
}

function KpiCard({
  label, value, sub, accent,
}: {
  label: string
  value: string
  sub?: string
  accent: 'rose' | 'amber' | 'gold'
}) {
  const accentClasses: Record<typeof accent, string> = {
    rose: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
    gold: 'bg-emerald-50 text-dr7-gold',
  }
  return (
    <div className="bg-theme-bg-primary border border-theme-border rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-theme-text-secondary uppercase tracking-wide">{label}</p>
        <span className={`inline-flex w-2 h-2 rounded-full ${accentClasses[accent].replace('bg-', 'bg-').replace('-50', '-500').split(' ')[0]}`} />
      </div>
      <p className="text-2xl font-bold text-theme-text-primary tracking-tight">{value}</p>
      {sub && <p className="text-xs text-theme-text-muted mt-1">{sub}</p>}
    </div>
  )
}
