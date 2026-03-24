import { useState, useEffect } from 'react'

interface DashboardData {
  period: { month: string; daysInMonth: number; daysElapsed: number }
  revenue: {
    currentMonth: number; previousMonth: number; changePercent: number
    incassato: number; incassatoPercent: number
    bySource: { rental: number; wash: number; penalties: number; danni: number }
  }
  fleet: {
    totalVehicles: number; rentedNow: number; idleNow: number
    occupationRate: number; previousRate: number; changePercent: number
    vehiclesIdleLong: Array<{ name: string; plate: string; idleDays: number }>
  }
  revenuePerVehicle: {
    avgPerDay: number; previousAvgPerDay: number; changePercent: number
    topPerformers: Array<{ name: string; plate: string; perDay: number; changePercent: number }>
    underPerformers: Array<{ name: string; plate: string; perDay: number }>
  }
  bookings: {
    total: number; previousTotal: number; changePercent: number
    confirmed: number; pending: number; cancelled: number; conversionRate: number
  }
  customers: {
    newThisMonth: number; activeThisMonth: number; previousNewCount: number
    changePercent: number; totalCustomers: number
  }
  damages: {
    danniAmount: number; previousDanniAmount: number; changePercent: number
    danniCount: number; insoluti: number; insolutiCount: number
  }
  cashFlow: {
    incassato: number; daIncassare: number; insolutiScaduti: number
  }
}

function formatEuro(n: number): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function TrendBadge({ value, suffix = '%', invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  if (value === 0) return <span className="text-theme-text-muted text-sm">-</span>
  const positive = invert ? value < 0 : value > 0
  const color = positive ? 'text-green-400' : 'text-red-400'
  const arrow = value > 0 ? '\u2191' : '\u2193'
  return (
    <span className={`${color} text-sm font-medium`}>
      {arrow} {value > 0 ? '+' : ''}{value}{suffix}
    </span>
  )
}

function KpiCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-theme-bg-secondary/50 backdrop-blur-sm rounded-xl border border-theme-border p-4 ${className}`}>
      <h3 className="text-xs uppercase tracking-wider text-theme-text-muted mb-3 font-semibold">{title}</h3>
      {children}
    </div>
  )
}

export default function DashboardTab() {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDashboard()
  }, [selectedMonth])

  const fetchDashboard = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/.netlify/functions/dashboard-kpi?month=${selectedMonth}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err: any) {
      setError(err.message || 'Errore nel caricamento')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold" />
        <span className="ml-3 text-theme-text-muted">Caricamento dashboard...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
        <p className="text-red-400 font-medium">Errore: {error}</p>
        <button onClick={fetchDashboard} className="mt-3 px-4 py-2 bg-dr7-gold text-black rounded-lg text-sm font-medium">
          Riprova
        </button>
      </div>
    )
  }

  if (!data) return null

  const d = data

  return (
    <div className="space-y-4">
      {/* Period Selector */}
      <div className="flex items-center gap-4">
        <label className="text-xs text-theme-text-muted">Periodo</label>
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
        />
      </div>

      {/* Section 1: KPI PRINCIPALI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Fatturato Mese">
          <p className="text-2xl font-bold text-[#D4AF37]">{'\u20AC'}{formatEuro(d.revenue.currentMonth)}</p>
          <TrendBadge value={d.revenue.changePercent} />
          <p className="text-xs text-theme-text-muted mt-1">vs mese precedente</p>
        </KpiCard>
        <KpiCard title="Incassato Mese">
          <p className="text-2xl font-bold text-green-400">{'\u20AC'}{formatEuro(d.revenue.incassato)}</p>
          <p className="text-sm text-theme-text-muted">{d.revenue.incassatoPercent}% del fatturato</p>
        </KpiCard>
        <KpiCard title="Occupazione Flotta">
          <p className="text-2xl font-bold text-[#D4AF37]">{d.fleet.occupationRate}%</p>
          <TrendBadge value={d.fleet.changePercent} suffix=" pts" />
        </KpiCard>
        <KpiCard title="Prenotazioni">
          <p className="text-2xl font-bold text-[#D4AF37]">{d.bookings.total}</p>
          <TrendBadge value={d.bookings.changePercent} />
        </KpiCard>
      </div>

      {/* Section 2: OCCUPAZIONE FLOTTA */}
      <KpiCard title="Occupazione Flotta - Dettaglio">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-full border-4 border-[#D4AF37] flex items-center justify-center">
                <span className="text-lg font-bold text-[#D4AF37]">{d.fleet.occupationRate}%</span>
              </div>
              <div>
                <p className="text-sm text-theme-text-primary">Noleggiati: <span className="font-bold text-green-400">{d.fleet.rentedNow}</span></p>
                <p className="text-sm text-theme-text-primary">Fermi: <span className="font-bold text-orange-400">{d.fleet.idleNow}</span></p>
                <p className="text-xs text-theme-text-muted">su {d.fleet.totalVehicles} veicoli</p>
              </div>
            </div>
            <div className="mt-2">
              <TrendBadge value={d.fleet.changePercent} suffix=" pts" />
              <span className="text-xs text-theme-text-muted ml-1">vs mese precedente</span>
            </div>
          </div>
          {d.fleet.vehiclesIdleLong.length > 0 && (
            <div className="md:col-span-2">
              <p className="text-xs text-red-400 font-semibold mb-2">Veicoli fermi {'>'}10 giorni</p>
              <div className="space-y-1">
                {d.fleet.vehiclesIdleLong.map((v, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-theme-text-primary">{v.name} <span className="text-theme-text-muted">({v.plate})</span></span>
                    <span className="text-red-400 font-medium">{v.idleDays}g fermo</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </KpiCard>

      {/* Section 3: RICAVO MEDIO PER VEICOLO */}
      <KpiCard title="Ricavo Medio per Veicolo">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-2xl font-bold text-[#D4AF37]">{'\u20AC'}{formatEuro(d.revenuePerVehicle.avgPerDay)} <span className="text-sm font-normal text-theme-text-muted">/giorno</span></p>
            <TrendBadge value={d.revenuePerVehicle.changePercent} />
            <span className="text-xs text-theme-text-muted ml-1">vs mese precedente</span>
          </div>
          <div>
            {d.revenuePerVehicle.topPerformers.length > 0 && (
              <>
                <p className="text-xs text-green-400 font-semibold mb-2">Top Performers</p>
                <div className="space-y-1">
                  {d.revenuePerVehicle.topPerformers.map((v, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-theme-text-primary">{v.name}</span>
                      <span className="text-green-400 font-medium">{'\u20AC'}{formatEuro(v.perDay)}/g</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        {d.revenuePerVehicle.underPerformers.length > 0 && (
          <div className="mt-3 pt-3 border-t border-theme-border">
            <p className="text-xs text-orange-400 font-semibold mb-2">Sotto la media</p>
            <div className="flex flex-wrap gap-2">
              {d.revenuePerVehicle.underPerformers.map((v, i) => (
                <span key={i} className="text-xs bg-orange-500/10 text-orange-400 px-2 py-1 rounded-full">
                  {v.name} ({'\u20AC'}{formatEuro(v.perDay)}/g)
                </span>
              ))}
            </div>
          </div>
        )}
      </KpiCard>

      {/* Section 4: PRENOTAZIONI */}
      <KpiCard title="Prenotazioni">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xl font-bold text-[#D4AF37]">{d.bookings.total}</p>
            <p className="text-xs text-theme-text-muted">Totale</p>
            <TrendBadge value={d.bookings.changePercent} />
          </div>
          <div>
            <p className="text-xl font-bold text-green-400">{d.bookings.confirmed}</p>
            <p className="text-xs text-theme-text-muted">Confermate</p>
          </div>
          <div>
            <p className="text-xl font-bold text-yellow-400">{d.bookings.pending}</p>
            <p className="text-xs text-theme-text-muted">In attesa</p>
          </div>
          <div>
            <p className="text-xl font-bold text-red-400">{d.bookings.cancelled}</p>
            <p className="text-xs text-theme-text-muted">Cancellate</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-theme-border">
          <p className="text-sm text-theme-text-primary">
            Tasso di conversione: <span className="font-bold text-[#D4AF37]">{d.bookings.conversionRate}%</span>
          </p>
        </div>
      </KpiCard>

      {/* Section 5: CLIENTI */}
      <KpiCard title="Clienti">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xl font-bold text-[#D4AF37]">{d.customers.newThisMonth}</p>
            <p className="text-xs text-theme-text-muted">Nuovi clienti</p>
            <TrendBadge value={d.customers.changePercent} />
          </div>
          <div>
            <p className="text-xl font-bold text-theme-text-primary">{d.customers.activeThisMonth}</p>
            <p className="text-xs text-theme-text-muted">Clienti attivi</p>
          </div>
          <div>
            <p className="text-xl font-bold text-theme-text-primary">{d.customers.totalCustomers.toLocaleString('it-IT')}</p>
            <p className="text-xs text-theme-text-muted">Totale clienti</p>
          </div>
        </div>
      </KpiCard>

      {/* Section 6: DANNI / RISCHI / INSOLUTI */}
      <KpiCard title="Danni / Rischi / Insoluti">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xl font-bold text-red-400">{'\u20AC'}{formatEuro(d.damages.danniAmount)}</p>
            <p className="text-xs text-theme-text-muted">Danni questo mese ({d.damages.danniCount})</p>
            <TrendBadge value={d.damages.changePercent} invert />
          </div>
          <div>
            <p className="text-xl font-bold text-orange-400">{'\u20AC'}{formatEuro(d.damages.insoluti)}</p>
            <p className="text-xs text-theme-text-muted">Insoluti ({d.damages.insolutiCount} voci)</p>
          </div>
          {d.damages.previousDanniAmount > 0 && (
            <div>
              <p className="text-xl font-bold text-theme-text-muted">{'\u20AC'}{formatEuro(d.damages.previousDanniAmount)}</p>
              <p className="text-xs text-theme-text-muted">Danni mese prec.</p>
            </div>
          )}
        </div>
      </KpiCard>

      {/* Section 7: CASH FLOW */}
      <KpiCard title="Cash Flow">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xl font-bold text-green-400">{'\u20AC'}{formatEuro(d.cashFlow.incassato)}</p>
            <p className="text-xs text-theme-text-muted">Incassato</p>
          </div>
          <div>
            <p className="text-xl font-bold text-orange-400">{'\u20AC'}{formatEuro(d.cashFlow.daIncassare)}</p>
            <p className="text-xs text-theme-text-muted">Da incassare</p>
          </div>
          <div>
            <p className="text-xl font-bold text-red-400">{'\u20AC'}{formatEuro(d.cashFlow.insolutiScaduti)}</p>
            <p className="text-xs text-theme-text-muted">Scaduti</p>
          </div>
        </div>
        {/* Visual bar */}
        {(d.cashFlow.incassato + d.cashFlow.daIncassare) > 0 && (
          <div className="mt-3 h-3 rounded-full overflow-hidden bg-theme-bg-tertiary flex">
            <div
              className="bg-green-500 h-full"
              style={{ width: `${Math.round((d.cashFlow.incassato / (d.cashFlow.incassato + d.cashFlow.daIncassare + d.cashFlow.insolutiScaduti)) * 100)}%` }}
            />
            <div
              className="bg-orange-500 h-full"
              style={{ width: `${Math.round((d.cashFlow.daIncassare / (d.cashFlow.incassato + d.cashFlow.daIncassare + d.cashFlow.insolutiScaduti)) * 100)}%` }}
            />
            <div
              className="bg-red-500 h-full"
              style={{ width: `${Math.round((d.cashFlow.insolutiScaduti / (d.cashFlow.incassato + d.cashFlow.daIncassare + d.cashFlow.insolutiScaduti)) * 100)}%` }}
            />
          </div>
        )}
      </KpiCard>

      {/* Revenue Breakdown */}
      <KpiCard title="Breakdown Fatturato">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-lg font-bold text-theme-text-primary">{'\u20AC'}{formatEuro(d.revenue.bySource.rental)}</p>
            <p className="text-xs text-theme-text-muted">Noleggi</p>
          </div>
          <div>
            <p className="text-lg font-bold text-theme-text-primary">{'\u20AC'}{formatEuro(d.revenue.bySource.wash)}</p>
            <p className="text-xs text-theme-text-muted">Lavaggi</p>
          </div>
          <div>
            <p className="text-lg font-bold text-theme-text-primary">{'\u20AC'}{formatEuro(d.revenue.bySource.penalties)}</p>
            <p className="text-xs text-theme-text-muted">Penali</p>
          </div>
          <div>
            <p className="text-lg font-bold text-theme-text-primary">{'\u20AC'}{formatEuro(d.revenue.bySource.danni)}</p>
            <p className="text-xs text-theme-text-muted">Danni</p>
          </div>
        </div>
      </KpiCard>
    </div>
  )
}
