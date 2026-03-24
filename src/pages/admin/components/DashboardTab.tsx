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

function fmt(n: number): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDec(n: number): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// SVG circular gauge
function CircularGauge({ value, size = 120, strokeWidth = 10, color = '#D4AF37' }: { value: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(value, 100) / 100) * circumference
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        className="transition-all duration-1000 ease-out" />
    </svg>
  )
}

// Trend indicator
function Trend({ value, suffix = '%', invert = false, size = 'sm' }: { value: number; suffix?: string; invert?: boolean; size?: 'sm' | 'lg' }) {
  if (value === 0) return <span className="text-theme-text-muted text-xs">--</span>
  const positive = invert ? value < 0 : value > 0
  const color = positive ? 'text-emerald-400' : 'text-red-400'
  const bgColor = positive ? 'bg-emerald-400/10' : 'bg-red-400/10'
  const arrow = value > 0 ? '\u2191' : '\u2193'
  const textSize = size === 'lg' ? 'text-sm px-2.5 py-1' : 'text-xs px-2 py-0.5'
  return (
    <span className={`${color} ${bgColor} ${textSize} font-semibold rounded-full inline-flex items-center gap-0.5`}>
      {arrow} {value > 0 ? '+' : ''}{value}{suffix}
    </span>
  )
}

// Section header with subtitle
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 mt-2">
      <h3 className="text-base font-bold text-theme-text-primary tracking-wide uppercase">{title}</h3>
      <p className="text-xs text-theme-text-muted mt-0.5">{subtitle}</p>
    </div>
  )
}

// Alert box
function AlertBox({ type, children }: { type: 'warning' | 'danger' | 'success' | 'info'; children: React.ReactNode }) {
  const styles = {
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
    danger: 'bg-red-500/10 border-red-500/30 text-red-300',
    success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
  }
  const icons = { warning: '\u26A0', danger: '\u26A0', success: '\u2705', info: '\u24D8' }
  return (
    <div className={`${styles[type]} border rounded-lg px-4 py-2.5 text-sm flex items-start gap-2`}>
      <span className="text-base mt-0.5 flex-shrink-0">{icons[type]}</span>
      <span>{children}</span>
    </div>
  )
}

// Stat card inside sections
function StatCard({ label, value, sub, trend, trendSuffix, trendInvert, accent, border }: {
  label: string; value: string; sub?: string; trend?: number; trendSuffix?: string; trendInvert?: boolean
  accent?: 'gold' | 'green' | 'red' | 'orange' | 'blue' | 'default'; border?: boolean
}) {
  const accentColors: Record<string, string> = {
    gold: 'text-[#D4AF37]', green: 'text-emerald-400', red: 'text-red-400',
    orange: 'text-amber-400', blue: 'text-blue-400', default: 'text-theme-text-primary'
  }
  const valueColor = accentColors[accent || 'default']
  return (
    <div className={`bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-4 ${border ? 'border border-theme-border' : 'border border-white/5'}`}>
      <p className="text-[10px] uppercase tracking-widest text-theme-text-muted font-semibold mb-2">{label}</p>
      <p className={`text-2xl font-bold ${valueColor} leading-tight`}>{value}</p>
      {sub && <p className="text-xs text-theme-text-muted mt-1">{sub}</p>}
      {trend !== undefined && (
        <div className="mt-2">
          <Trend value={trend} suffix={trendSuffix} invert={trendInvert} />
          <span className="text-[10px] text-theme-text-muted ml-1.5">vs mese scorso</span>
        </div>
      )}
    </div>
  )
}

// Health score calculation
function calcHealthScore(d: DashboardData): { score: number; label: string; color: string } {
  let score = 50
  // Revenue trend
  if (d.revenue.changePercent > 10) score += 15
  else if (d.revenue.changePercent > 0) score += 10
  else if (d.revenue.changePercent > -10) score += 5
  // Fleet utilization
  if (d.fleet.occupationRate >= 70) score += 15
  else if (d.fleet.occupationRate >= 50) score += 10
  else score += 3
  // Collection rate
  if (d.revenue.incassatoPercent >= 80) score += 10
  else if (d.revenue.incassatoPercent >= 60) score += 5
  // Bookings trend
  if (d.bookings.changePercent > 0) score += 5
  // Low damages
  if (d.damages.danniAmount === 0) score += 5
  else if (d.damages.changePercent < 0) score += 3

  score = Math.min(100, Math.max(0, score))
  let label = 'Critico'
  let color = '#ef4444'
  if (score >= 80) { label = 'Ottimo'; color = '#10b981' }
  else if (score >= 60) { label = 'Buono'; color = '#D4AF37' }
  else if (score >= 40) { label = 'Attenzione'; color = '#f59e0b' }
  return { score, label, color }
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

  // Format month for display
  const formatMonth = (m: string) => {
    const [y, mo] = m.split('-')
    const months = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
    return `${months[parseInt(mo) - 1]} ${y}`
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-4 border-theme-border animate-spin" style={{ borderTopColor: '#D4AF37' }} />
        </div>
        <p className="text-theme-text-muted text-sm">Caricamento dashboard...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 text-center max-w-md mx-auto mt-12">
        <p className="text-red-400 font-medium text-lg mb-2">Errore nel caricamento</p>
        <p className="text-theme-text-muted text-sm mb-4">{error}</p>
        <button onClick={fetchDashboard} className="px-6 py-2.5 bg-[#D4AF37] text-black rounded-xl text-sm font-bold hover:bg-[#c4a030] transition-colors">
          Riprova
        </button>
      </div>
    )
  }

  if (!data) return null

  const d = data
  const health = calcHealthScore(d)
  const cashTotal = d.cashFlow.incassato + d.cashFlow.daIncassare + d.cashFlow.insolutiScaduti
  const conversionLabel = d.bookings.conversionRate >= 85 ? 'Ottimo' : d.bookings.conversionRate >= 70 ? 'Buono' : 'Da migliorare'

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">

      {/* ========== HEADER ========== */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-xl font-bold text-theme-text-primary tracking-wide">DASHBOARD PROPRIETARIO</h2>
          <p className="text-xs text-theme-text-muted mt-0.5">La visione strategica della tua azienda</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] outline-none"
          />
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-theme-text-muted uppercase">Periodo</p>
            <p className="text-sm font-semibold text-theme-text-primary">{formatMonth(selectedMonth)}</p>
          </div>
        </div>
      </div>

      {/* ========== KPI PRINCIPALI ========== */}
      <div>
        <SectionHeader title="KPI Principali" subtitle="La situazione della tua azienda in uno sguardo" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard label="Fatturato Mese" value={`\u20AC ${fmt(d.revenue.currentMonth)}`} trend={d.revenue.changePercent} accent="gold" border />
          <StatCard label="Incassato Mese" value={`\u20AC ${fmt(d.revenue.incassato)}`} sub={`${d.revenue.incassatoPercent}% del fatturato`} accent="green" border />
          <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-4 border border-white/5">
            <p className="text-[10px] uppercase tracking-widest text-theme-text-muted font-semibold mb-2">Breakdown Fatturato</p>
            <div className="space-y-2">
              {[
                { label: 'Noleggi', value: d.revenue.bySource.rental, color: 'bg-[#D4AF37]' },
                { label: 'Lavaggi', value: d.revenue.bySource.wash, color: 'bg-blue-400' },
                { label: 'Penali', value: d.revenue.bySource.penalties, color: 'bg-amber-400' },
                { label: 'Danni', value: d.revenue.bySource.danni, color: 'bg-red-400' },
              ].filter(s => s.value > 0).map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${s.color}`} />
                    <span className="text-theme-text-muted">{s.label}</span>
                  </div>
                  <span className="text-theme-text-primary font-medium">{'\u20AC'} {fmt(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ========== OCCUPAZIONE FLOTTA ========== */}
      <div>
        <SectionHeader title="Occupazione Flotta" subtitle="Stai sfruttando bene le tue auto?" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Gauge + counts */}
          <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-white/5 flex flex-col items-center">
            <div className="relative">
              <CircularGauge value={d.fleet.occupationRate} size={130} strokeWidth={12} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-[#D4AF37]">{d.fleet.occupationRate}%</span>
                <span className="text-[10px] text-theme-text-muted uppercase tracking-wider">Occupazione</span>
              </div>
            </div>
            <div className="flex gap-6 mt-4">
              <div className="text-center">
                <p className="text-xl font-bold text-emerald-400">{d.fleet.rentedNow}</p>
                <p className="text-[9px] uppercase tracking-wider text-theme-text-muted">Veicoli Noleggiati</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-amber-400">{d.fleet.idleNow}</p>
                <p className="text-[9px] uppercase tracking-wider text-theme-text-muted">Veicoli Fermi</p>
              </div>
            </div>
          </div>

          {/* Comparison */}
          <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-white/5">
            <p className="text-[10px] uppercase tracking-widest text-theme-text-muted font-semibold mb-3">Confronto periodo precedente</p>
            <div className="flex gap-4 mb-4">
              <div>
                <Trend value={d.fleet.changePercent} suffix="%" size="lg" />
                <p className="text-[10px] text-theme-text-muted mt-1">Occupazione</p>
              </div>
            </div>
            <div className="space-y-2 mt-4">
              <div className="flex justify-between text-xs">
                <span className="text-theme-text-muted">Mese corrente</span>
                <span className="text-theme-text-primary font-medium">{d.fleet.occupationRate}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full bg-[#D4AF37] rounded-full transition-all duration-1000" style={{ width: `${d.fleet.occupationRate}%` }} />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-theme-text-muted">Mese precedente</span>
                <span className="text-theme-text-primary font-medium">{d.fleet.previousRate}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full bg-white/20 rounded-full transition-all duration-1000" style={{ width: `${d.fleet.previousRate}%` }} />
              </div>
            </div>
          </div>

          {/* Alerts */}
          <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-white/5">
            <p className="text-[10px] uppercase tracking-widest text-theme-text-muted font-semibold mb-3">Attenzione</p>
            {d.fleet.vehiclesIdleLong.length > 0 ? (
              <>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3">
                  <p className="text-amber-300 text-xs font-semibold">{d.fleet.vehiclesIdleLong.length} veicoli fermi da oltre 10 giorni</p>
                </div>
                <div className="space-y-2 max-h-[140px] overflow-y-auto">
                  {d.fleet.vehiclesIdleLong.map((v, i) => (
                    <div key={i} className="flex justify-between items-center text-xs bg-white/[0.03] rounded-lg px-3 py-2">
                      <div>
                        <span className="text-theme-text-primary font-medium">{v.name}</span>
                        <span className="text-theme-text-muted ml-1.5">{v.plate}</span>
                      </div>
                      <span className="text-red-400 font-bold">{v.idleDays}g</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <p className="text-emerald-300 text-xs font-semibold">Tutti i veicoli attivi</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========== RICAVO MEDIO + PRENOTAZIONI (side by side) ========== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* RICAVO MEDIO PER VEICOLO */}
        <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-white/5">
          <p className="text-[10px] uppercase tracking-widest text-theme-text-muted font-semibold mb-3">Ricavo Medio per Veicolo</p>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-bold text-[#D4AF37]">{'\u20AC'} {fmtDec(d.revenuePerVehicle.avgPerDay)}</span>
            <span className="text-sm text-theme-text-muted">/giorno</span>
          </div>
          <div className="mb-4">
            <Trend value={d.revenuePerVehicle.changePercent} />
            <span className="text-[10px] text-theme-text-muted ml-1.5">vs mese scorso</span>
          </div>

          {d.revenuePerVehicle.topPerformers.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2 font-semibold">Top Performer</p>
              <div className="space-y-1.5">
                {d.revenuePerVehicle.topPerformers.map((v, i) => (
                  <div key={i} className="flex items-center justify-between bg-white/[0.03] rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? 'bg-[#D4AF37] text-black' : 'bg-white/10 text-theme-text-muted'}`}>
                        {i + 1}
                      </span>
                      <span className="text-sm text-theme-text-primary">{v.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-emerald-400">{'\u20AC'} {fmtDec(v.perDay)}/g</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {d.revenuePerVehicle.underPerformers.length > 0 && (
            <AlertBox type="warning">
              {d.revenuePerVehicle.underPerformers.length} veicoli sotto la media: {d.revenuePerVehicle.underPerformers.map(v => `${v.name} (\u20AC${fmtDec(v.perDay)}/g)`).join(' \u2022 ')}
            </AlertBox>
          )}
        </div>

        {/* PRENOTAZIONI */}
        <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-white/5">
          <p className="text-[10px] uppercase tracking-widest text-theme-text-muted font-semibold mb-3">Prenotazioni</p>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-bold text-[#D4AF37]">{d.bookings.total}</span>
          </div>
          <div className="mb-5">
            <Trend value={d.bookings.changePercent} />
            <span className="text-[10px] text-theme-text-muted ml-1.5">vs mese scorso</span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center bg-emerald-500/10 rounded-xl py-3">
              <p className="text-2xl font-bold text-emerald-400">{d.bookings.confirmed}</p>
              <p className="text-[9px] uppercase tracking-wider text-emerald-300/70 mt-0.5">Confermate</p>
            </div>
            <div className="text-center bg-amber-500/10 rounded-xl py-3">
              <p className="text-2xl font-bold text-amber-400">{d.bookings.pending}</p>
              <p className="text-[9px] uppercase tracking-wider text-amber-300/70 mt-0.5">In Attesa</p>
            </div>
            <div className="text-center bg-red-500/10 rounded-xl py-3">
              <p className="text-2xl font-bold text-red-400">{d.bookings.cancelled}</p>
              <p className="text-[9px] uppercase tracking-wider text-red-300/70 mt-0.5">Cancellazioni</p>
            </div>
          </div>

          <div className="bg-white/[0.03] rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-theme-text-muted">Tasso di conversione</p>
              <p className="text-lg font-bold text-[#D4AF37]">{d.bookings.conversionRate}% <span className="text-xs font-normal text-theme-text-muted">({conversionLabel})</span></p>
            </div>
            <div className="w-20 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${d.bookings.conversionRate}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ========== CLIENTI ========== */}
      <div>
        <SectionHeader title="Clienti" subtitle="La salute del tuo business" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard label="Nuovi Clienti" value={String(d.customers.newThisMonth)} trend={d.customers.changePercent} accent="gold" border />
          <StatCard label="Clienti Attivi" value={fmt(d.customers.activeThisMonth)} accent="default" border />
          <StatCard label="Totale Clienti" value={fmt(d.customers.totalCustomers)} accent="default" border />
        </div>
      </div>

      {/* ========== DANNI / RISCHI / INSOLUTI ========== */}
      <div>
        <SectionHeader title="Danni / Rischi / Insoluti" subtitle="Dove stai perdendo soldi?" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
          <StatCard
            label="Danni Questo Mese"
            value={`\u20AC ${fmt(d.damages.danniAmount)}`}
            sub={`${d.damages.danniCount} sinistri aperti`}
            trend={d.damages.changePercent}
            trendInvert
            accent="red"
            border
          />
          <StatCard
            label="Insoluti"
            value={`\u20AC ${fmt(d.damages.insoluti)}`}
            sub={`${d.damages.insolutiCount} pagamenti in ritardo`}
            accent="orange"
            border
          />
          {d.damages.previousDanniAmount > 0 && (
            <StatCard label="Danni Mese Precedente" value={`\u20AC ${fmt(d.damages.previousDanniAmount)}`} accent="default" border />
          )}
        </div>
        {d.damages.insoluti > 0 && (
          <AlertBox type="danger">
            {'\u20AC'} {fmt(d.damages.insoluti)} di insoluti da recuperare ({d.damages.insolutiCount} voci in attesa di pagamento)
          </AlertBox>
        )}
      </div>

      {/* ========== CASH FLOW ========== */}
      <div>
        <SectionHeader title="Cash Flow" subtitle="Liquidit\u00E0 aziendale" />
        <div className="grid grid-cols-3 gap-3 mb-3">
          <StatCard label="Incassato" value={`\u20AC ${fmt(d.cashFlow.incassato)}`} accent="green" border />
          <StatCard label="Da Incassare" value={`\u20AC ${fmt(d.cashFlow.daIncassare)}`} accent="orange" border />
          <StatCard label="Scaduti" value={`\u20AC ${fmt(d.cashFlow.insolutiScaduti)}`} accent="red" border />
        </div>
        {/* Visual progress bar */}
        {cashTotal > 0 && (
          <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-4 border border-white/5">
            <div className="flex justify-between text-[10px] text-theme-text-muted uppercase tracking-wider mb-2">
              <span>Distribuzione</span>
              <span>Totale: {'\u20AC'} {fmt(cashTotal)}</span>
            </div>
            <div className="h-4 rounded-full overflow-hidden bg-white/5 flex">
              <div className="bg-emerald-500 h-full transition-all duration-700 relative group" style={{ width: `${Math.round((d.cashFlow.incassato / cashTotal) * 100)}%` }}>
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white opacity-0 group-hover:opacity-100">{Math.round((d.cashFlow.incassato / cashTotal) * 100)}%</span>
              </div>
              <div className="bg-amber-500 h-full transition-all duration-700" style={{ width: `${Math.round((d.cashFlow.daIncassare / cashTotal) * 100)}%` }} />
              <div className="bg-red-500 h-full transition-all duration-700" style={{ width: `${Math.round((d.cashFlow.insolutiScaduti / cashTotal) * 100)}%` }} />
            </div>
            <div className="flex gap-4 mt-2">
              <div className="flex items-center gap-1.5 text-[10px] text-theme-text-muted">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Incassato
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-theme-text-muted">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Da incassare
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-theme-text-muted">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" /> Scaduti
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========== STATO DI SALUTE ========== */}
      <div className="bg-gradient-to-r from-theme-bg-secondary/80 to-theme-bg-secondary/40 backdrop-blur-sm rounded-2xl p-6 border border-white/5">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="relative flex-shrink-0">
            <CircularGauge value={health.score} size={100} strokeWidth={8} color={health.color} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold" style={{ color: health.color }}>{health.score}%</span>
              <span className="text-[9px] uppercase tracking-wider text-theme-text-muted">{health.label}</span>
            </div>
          </div>
          <div className="text-center sm:text-left">
            <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide mb-1">Stato di Salute Azienda</h3>
            <p className="text-xs text-theme-text-muted leading-relaxed">
              {health.score >= 80 && 'Crescita positiva, margini sotto controllo, operativit\u00E0 solida.'}
              {health.score >= 60 && health.score < 80 && 'Andamento buono con margini di miglioramento. Monitora occupazione flotta e incasso.'}
              {health.score >= 40 && health.score < 60 && 'Alcuni indicatori richiedono attenzione. Verifica insoluti e occupazione veicoli.'}
              {health.score < 40 && 'Situazione critica. Azione immediata necessaria su pi\u00F9 fronti.'}
            </p>
          </div>
        </div>
      </div>

    </div>
  )
}
