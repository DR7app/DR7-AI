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

type Filter = 'both' | 'penali' | 'danni'
type TypedEntry = VehicleEntry & { type: 'penali' | 'danni' }

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

export default function ReportPenaliDanniTab() {
  const [filter, setFilter] = useState<Filter>('both')
  const [penaliData, setPenaliData] = useState<ReportData | null>(null)
  const [danniData, setDanniData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortField, setSortField] = useState<'totalAmount' | 'count'>('totalAmount')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 8

  useEffect(() => { fetchReports() }, [])
  useEffect(() => { setPage(1) }, [filter, sortField])

  async function fetchReports() {
    setLoading(true)
    setError('')
    try {
      const [penaliRes, danniRes] = await Promise.all([
        fetch('/.netlify/functions/report-danni?type=penali'),
        fetch('/.netlify/functions/report-danni?type=danni'),
      ])
      const [penaliJson, danniJson] = await Promise.all([penaliRes.json(), danniRes.json()])
      if (!penaliRes.ok) throw new Error(penaliJson.error || 'Errore penali')
      if (!danniRes.ok) throw new Error(danniJson.error || 'Errore danni')
      setPenaliData(penaliJson)
      setDanniData(danniJson)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  // ── Derived data ────────────────────────────────────────────────────────────
  const merged: TypedEntry[] = useMemo(() => {
    const out: TypedEntry[] = []
    if (filter !== 'danni' && penaliData?.vehicles) penaliData.vehicles.forEach(v => out.push({ ...v, type: 'penali' }))
    if (filter !== 'penali' && danniData?.vehicles) danniData.vehicles.forEach(v => out.push({ ...v, type: 'danni' }))
    return out.sort((a, b) => sortField === 'totalAmount' ? b.totalAmount - a.totalAmount : b.count - a.count)
  }, [penaliData, danniData, filter, sortField])

  const danniCount = danniData?.totalCount || 0
  const danniAmount = danniData?.totalAmount || 0
  const penaliCount = penaliData?.totalCount || 0
  const penaliAmount = penaliData?.totalAmount || 0
  const combinedAmount = danniAmount + penaliAmount
  const combinedCount = danniCount + penaliCount

  // Top vehicles (cross both types, by total amount)
  const topVehicles = useMemo(() => {
    const map = new Map<string, { name: string; plate: string; total: number; count: number }>()
    const allVehicles = [
      ...(danniData?.vehicles || []).map(v => ({ ...v, type: 'danni' as const })),
      ...(penaliData?.vehicles || []).map(v => ({ ...v, type: 'penali' as const })),
    ]
    for (const v of allVehicles) {
      const key = v.vehiclePlate || v.vehicleName
      const cur = map.get(key) || { name: v.vehicleName, plate: v.vehiclePlate, total: 0, count: 0 }
      cur.total += v.totalAmount
      cur.count += v.count
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 5)
  }, [danniData, penaliData])

  // Top problematic customers
  const topCustomers = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>()
    const allVehicles = [
      ...(danniData?.vehicles || []),
      ...(penaliData?.vehicles || []),
    ]
    for (const v of allVehicles) {
      if (!v.customerName || v.customerName === '-') continue
      const cur = map.get(v.customerName) || { name: v.customerName, total: 0, count: 0 }
      cur.total += v.totalAmount
      cur.count += v.count
      map.set(v.customerName, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 5)
  }, [danniData, penaliData])

  // Type split for the breakdown bar
  const danniPct = combinedAmount > 0 ? Math.round((danniAmount / combinedAmount) * 100) : 0
  const penaliPct = 100 - danniPct

  // ── Pagination ──────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(merged.length / PAGE_SIZE))
  const pageItems = merged.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary tracking-tight">Report Danni & Penali</h2>
          <p className="text-sm text-theme-text-secondary mt-0.5">Panoramica delle pratiche di danno e penale registrate sul parco veicoli</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchReports}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-theme-text-primary text-sm font-semibold rounded-full border border-theme-border hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            {loading ? 'Aggiorno…' : 'Aggiorna'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {/* ── KPI cards (4) ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Totale Danni"
          value={formatCurrency(danniAmount)}
          sub={`${danniCount} ${danniCount === 1 ? 'caso' : 'casi'}`}
          accent="rose"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          }
        />
        <KpiCard
          label="Veicoli Danneggiati"
          value={`${danniData?.totalVehicles || 0}`}
          sub="con danni registrati"
          accent="amber"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          }
        />
        <KpiCard
          label="Penali Applicate"
          value={`${penaliCount}`}
          sub={formatCurrency(penaliAmount)}
          accent="orange"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          }
        />
        <KpiCard
          label="Importo Totale"
          value={formatCurrency(combinedAmount)}
          sub={`${combinedCount} voci`}
          accent="gold"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          }
        />
      </div>

      {/* ── Filter pills ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          { key: 'both' as Filter, label: 'Tutti', count: combinedCount, dot: 'bg-dr7-gold' },
          { key: 'danni' as Filter, label: 'Danni', count: danniCount, dot: 'bg-rose-500' },
          { key: 'penali' as Filter, label: 'Penali', count: penaliCount, dot: 'bg-orange-500' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
              filter === t.key
                ? 'bg-theme-bg-primary border-theme-border text-theme-text-primary shadow-sm'
                : 'bg-transparent border-transparent text-theme-text-secondary hover:bg-theme-bg-hover'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
            {t.label}
            <span className="text-xs text-theme-text-muted">{t.count}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
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

      {/* ── Main grid ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: list */}
        <div className="lg:col-span-2 bg-theme-bg-primary border border-theme-border rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-theme-text-primary">Lista Danni & Penali</h3>
              <p className="text-xs text-theme-text-muted">{merged.length} {merged.length === 1 ? 'voce' : 'voci'}</p>
            </div>
          </div>

          {loading && (
            <div className="px-5 py-12 text-center text-theme-text-muted text-sm">Caricamento…</div>
          )}

          {!loading && merged.length === 0 && (
            <div className="px-5 py-12 text-center text-theme-text-muted text-sm">Nessuna voce da mostrare per questo filtro.</div>
          )}

          {!loading && merged.length > 0 && (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-theme-bg-tertiary/40 border-b border-theme-border text-xs uppercase tracking-wide text-theme-text-secondary">
                      <th className="px-5 py-3 text-left font-medium">Tipo</th>
                      <th className="px-5 py-3 text-left font-medium">Veicolo</th>
                      <th className="px-5 py-3 text-left font-medium">Cliente</th>
                      <th className="px-5 py-3 text-center font-medium">N.</th>
                      <th className="px-5 py-3 text-right font-medium">Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((v, i) => (
                      <tr key={`${v.type}-${v.vehiclePlate}-${i}`} className="border-b border-theme-border last:border-0 hover:bg-theme-bg-hover/40 transition-colors">
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                            v.type === 'danni'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-orange-50 text-orange-700 border-orange-200'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${v.type === 'danni' ? 'bg-rose-500' : 'bg-orange-500'}`} />
                            {v.type === 'danni' ? 'Danno' : 'Penale'}
                          </span>
                        </td>
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
                        <td className="px-5 py-3 text-center font-semibold text-theme-text-primary">{v.count}</td>
                        <td className="px-5 py-3 text-right font-semibold text-dr7-gold">{formatCurrencyDecimal(v.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-theme-border">
                {pageItems.map((v, i) => (
                  <div key={`${v.type}-${v.vehiclePlate}-${i}`} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="font-medium text-theme-text-primary truncate">{v.vehicleName}</div>
                        <div className="text-xs text-theme-text-muted">{v.vehiclePlate}</div>
                        <div className="text-xs text-theme-text-secondary mt-0.5 truncate">{v.customerName || '—'}</div>
                      </div>
                      <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                        v.type === 'danni' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-orange-50 text-orange-700 border-orange-200'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${v.type === 'danni' ? 'bg-rose-500' : 'bg-orange-500'}`} />
                        {v.type === 'danni' ? 'Danno' : 'Penale'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-theme-text-secondary">N. {v.count}</span>
                      <span className="font-semibold text-dr7-gold">{formatCurrencyDecimal(v.totalAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-theme-border flex items-center justify-between text-xs text-theme-text-secondary">
                  <span>Mostra {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, merged.length)} di {merged.length}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary disabled:opacity-40 hover:bg-theme-bg-hover"
                    >‹</button>
                    {Array.from({ length: totalPages }).slice(0, 6).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setPage(i + 1)}
                        className={`w-7 h-7 rounded text-xs font-medium ${
                          page === i + 1
                            ? 'bg-dr7-gold text-white'
                            : 'border border-theme-border bg-theme-bg-primary hover:bg-theme-bg-hover'
                        }`}
                      >{i + 1}</button>
                    ))}
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary disabled:opacity-40 hover:bg-theme-bg-hover"
                    >›</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: side panels */}
        <div className="space-y-4">
          {/* Analisi Economica */}
          <SidePanel title="Analisi Economica">
            <Row label="Danni Totali" value={formatCurrencyDecimal(danniAmount)} valueClass="text-rose-600" />
            <Row label="Penali Totali" value={formatCurrencyDecimal(penaliAmount)} valueClass="text-orange-600" />
            <Row label="Combinato" value={formatCurrencyDecimal(combinedAmount)} valueClass="text-dr7-gold font-semibold" />
            <Row label="Casi Totali" value={`${combinedCount}`} />
            {/* Split bar */}
            {combinedAmount > 0 && (
              <div className="pt-2">
                <div className="h-2 rounded-full overflow-hidden flex bg-theme-bg-tertiary">
                  <div className="bg-rose-400" style={{ width: `${danniPct}%` }} />
                  <div className="bg-orange-400" style={{ width: `${penaliPct}%` }} />
                </div>
                <div className="flex justify-between text-xs text-theme-text-muted mt-1.5">
                  <span>Danni {danniPct}%</span>
                  <span>Penali {penaliPct}%</span>
                </div>
              </div>
            )}
          </SidePanel>

          {/* Veicoli Più Danneggiati */}
          <SidePanel title="Veicoli Più Coinvolti">
            {topVehicles.length === 0 ? (
              <p className="text-xs text-theme-text-muted">Nessun veicolo registrato.</p>
            ) : topVehicles.map(v => (
              <div key={v.plate} className="flex items-center justify-between gap-3 py-1.5 border-b border-theme-border last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-theme-text-primary truncate">{v.name}</p>
                  <p className="text-xs text-theme-text-muted">{v.plate} · {v.count} voci</p>
                </div>
                <span className="text-sm font-semibold text-dr7-gold whitespace-nowrap">{formatCurrency(v.total)}</span>
              </div>
            ))}
          </SidePanel>

          {/* Clienti Problematici */}
          <SidePanel title="Clienti Problematici">
            {topCustomers.length === 0 ? (
              <p className="text-xs text-theme-text-muted">Nessun cliente registrato.</p>
            ) : topCustomers.map(c => (
              <div key={c.name} className="flex items-center justify-between gap-3 py-1.5 border-b border-theme-border last:border-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold shrink-0 ${avatarColor(c.name)}`}>
                    {initials(c.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-theme-text-primary truncate">{c.name}</p>
                    <p className="text-xs text-theme-text-muted">{c.count} voci</p>
                  </div>
                </div>
                <span className="text-sm font-semibold text-dr7-gold whitespace-nowrap">{formatCurrency(c.total)}</span>
              </div>
            ))}
          </SidePanel>
        </div>
      </div>
    </div>
  )
}

// ── Reusable subcomponents ─────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent, icon,
}: {
  label: string
  value: string
  sub?: string
  accent: 'rose' | 'amber' | 'orange' | 'gold'
  icon: React.ReactNode
}) {
  const accentClasses: Record<typeof accent, string> = {
    rose: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
    orange: 'bg-orange-50 text-orange-600',
    gold: 'bg-emerald-50 text-dr7-gold',
  }
  return (
    <div className="bg-theme-bg-primary border border-theme-border rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-theme-text-secondary uppercase tracking-wide">{label}</p>
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${accentClasses[accent]}`}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-theme-text-primary tracking-tight">{value}</p>
      {sub && <p className="text-xs text-theme-text-muted mt-1">{sub}</p>}
    </div>
  )
}

function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-theme-text-primary mb-3">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Row({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-theme-text-secondary">{label}</span>
      <span className={`text-sm text-theme-text-primary ${valueClass}`}>{value}</span>
    </div>
  )
}
