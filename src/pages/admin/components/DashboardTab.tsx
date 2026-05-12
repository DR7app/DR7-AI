import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../../utils/authFetch'
import { supabase } from '../../../supabaseClient'

interface DashboardData {
  period: { month: string; daysInMonth: number; daysElapsed: number }
  revenue: {
    currentMonth: number; previousMonth: number; changePercent: number
    incassato: number; incassatoPercent: number
    cancelledRentalsTotal?: number; cancelledRentalsCount?: number
    washTotal?: number; washCount?: number
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
  monthlyReports?: {
    noleggio: { ricavoTotale: number; ricavoMesePrev: number; ricavoChangePercent: number; prenotazioniCount: number; prenotazioniAnnullateCount: number; prenotazioniAnnullateValue: number; link: string }
    lavaggio: { ricavoTotale: number; count: number; link: string }
    clienti: { nuoviMese: number; attiviMese: number; totale: number; changePercent: number; link: string }
    penaliDanni: { danniTotale: number; danniCount: number; insolutiTotale: number; insolutiCount: number; link: string }
    preventivi: {
      total: number; accettati: number; rifiutatiCount: number; conversionRate: number;
      motivoCounts: { cauzione: number; prezzo: number; non_specificato: number };
      link: string
      salvati?: number
      scadutiCount?: number
      valorePotenzialePerso?: number
      valoreAccettato?: number
      topVehicles?: Array<{ vehicle: string; count: number; converted: number; conversionRate: number; lostValue: number }>
      topPeriodi?: Array<{ periodo: string; count: number }>
      fasceConversione?: Array<{ range: string; total: number; converted: number; conversionRate: number }>
      topPerdite?: Array<{ id: string; vehicle: string; pickup: string; dropoff: string; days: number; value: number; motivo: string | null; status: string }>
      azioniSuggerite?: string[]
    }
    fornitori: { pagatoMese: number; daPagare: number; scaduto: number; alertsOpen: number; link: string }
  }
}

function fmt(n: number): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDec(n: number): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// SVG circular gauge
function CircularGauge({ value, size = 120, strokeWidth = 10, color = '#19C2D6' }: { value: number; size?: number; strokeWidth?: number; color?: string }) {
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
    gold: 'text-[#19C2D6]', green: 'text-emerald-400', red: 'text-red-400',
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
  else if (score >= 60) { label = 'Buono'; color = '#19C2D6' }
  else if (score >= 40) { label = 'Attenzione'; color = '#f59e0b' }
  return { score, label, color }
}

// localStorage cache — keep snapshot per (month) so reopening the dashboard
// doesn't need to re-sync every time. The snapshot has a timestamp so we can
// show the user how stale it is + a manual refresh.
const CACHE_PREFIX = 'dr7_dashboard_cache_v1'
const SUPPLIER_CACHE_PREFIX = 'dr7_dashboard_supplier_cache_v1'
type Cached<T> = { data: T; cachedAt: string }

function readCache<T>(key: string): Cached<T> | null {
    try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        return JSON.parse(raw) as Cached<T>
    } catch { return null }
}
function writeCache<T>(key: string, data: T) {
    try {
        const payload: Cached<T> = { data, cachedAt: new Date().toISOString() }
        localStorage.setItem(key, JSON.stringify(payload))
    } catch { /* quota / serialize errors — silent */ }
}

// Helpers for date range
function todayIsoRome(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}
function firstDayOfMonthIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function lastDayOfMonthIso(d = new Date()): string {
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}
function isoAddDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export default function DashboardTab() {
  // Selected date range — default to the current calendar month.
  const [dateFrom, setDateFrom] = useState<string>(() => firstDayOfMonthIso())
  const [dateTo, setDateTo] = useState<string>(() => lastDayOfMonthIso())
  // Kept around so the existing payload `period.month` and back-compat
  // logging still work — derived from dateFrom.
  const selectedMonth = dateFrom.substring(0, 7)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [showAlertDetails, setShowAlertDetails] = useState(false)
  const [alertDetails, setAlertDetails] = useState<Array<{ id: string; tipo: string; severity: string; messaggio: string; created_at: string; fornitore_nome: string; fornitore_id: string }> | null>(null)
  const [alertDetailsLoading, setAlertDetailsLoading] = useState(false)

  useEffect(() => {
    if (!showAlertDetails || alertDetails) return
    setAlertDetailsLoading(true)
    ;(async () => {
      try {
        const { data: alerts } = await supabase
          .from('fornitore_alerts')
          .select('id, tipo, severity, messaggio, created_at, fornitore_id')
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(20)
        if (!alerts || alerts.length === 0) {
          setAlertDetails([])
          return
        }
        const ids = Array.from(new Set(alerts.map(a => a.fornitore_id).filter(Boolean)))
        const { data: forns } = await supabase
          .from('fornitori')
          .select('id, nome')
          .in('id', ids)
        const byId = new Map((forns || []).map(f => [f.id, f.nome]))
        setAlertDetails(alerts.map(a => ({
          id: a.id,
          tipo: a.tipo,
          severity: a.severity,
          messaggio: a.messaggio,
          created_at: a.created_at,
          fornitore_id: a.fornitore_id,
          fornitore_nome: byId.get(a.fornitore_id) || '(fornitore sconosciuto)',
        })))
      } catch (err) {
        console.error('[Dashboard] alert details fetch failed:', err)
        setAlertDetails([])
      } finally {
        setAlertDetailsLoading(false)
      }
    })()
  }, [showAlertDetails, alertDetails])

  // Supplier costs state
  const [supplierData, setSupplierData] = useState<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invoices: any[]; supplierTotals: Record<string, { count: number; total: number }>
    grandTotal: number; totalCount: number
  } | null>(null)
  const [supplierLoading, setSupplierLoading] = useState(false)
  const [supplierError, setSupplierError] = useState<string | null>(null)
  const [supplierExpanded, setSupplierExpanded] = useState(false)
  const [supplierDetailOpen, setSupplierDetailOpen] = useState<string | null>(null)

  const fetchSupplierCosts = useCallback(async (month: string, opts?: { useCache?: boolean }) => {
    const cacheKey = `${SUPPLIER_CACHE_PREFIX}:${month}`
    if (opts?.useCache !== false) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cached = readCache<any>(cacheKey)
      if (cached) {
        setSupplierData(cached.data)
      }
    }
    setSupplierLoading(true)
    setSupplierError(null)
    try {
      const res = await fetch(`/.netlify/functions/get-incoming-invoices?month=${month}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setSupplierData(json)
      writeCache(cacheKey, json)
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      console.error('[Dashboard] Supplier costs error:', err)
      setSupplierError(_errMsg || 'Errore sconosciuto')
      // Keep cached data visible if fetch failed
    } finally {
      setSupplierLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboard({ useCache: true })
    fetchSupplierCosts(selectedMonth, { useCache: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo])

  const fetchDashboard = async (opts?: { useCache?: boolean; force?: boolean }) => {
    const cacheKey = `${CACHE_PREFIX}:${dateFrom}_${dateTo}`
    if (opts?.useCache !== false) {
      const cached = readCache<DashboardData>(cacheKey)
      if (cached) {
        setData(cached.data)
        setCachedAt(cached.cachedAt)
        if (!opts?.force) {
          // Show cached instantly; refresh in background.
        }
      }
    }
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/.netlify/functions/dashboard-kpi?from=${dateFrom}&to=${dateTo}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      const now = new Date().toISOString()
      setCachedAt(now)
      writeCache(cacheKey, json)
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      setError(_errMsg || 'Errore nel caricamento')
      // If we have cached data, keep it visible; just surface the error
    } finally {
      setLoading(false)
    }
  }

  function refreshAll() {
    fetchDashboard({ force: true })
    fetchSupplierCosts(selectedMonth, { useCache: false })
  }

  function fmtRelative(iso: string | null): string {
    if (!iso) return ''
    const dt = new Date(iso).getTime()
    if (isNaN(dt)) return ''
    const diff = Math.max(0, Math.floor((Date.now() - dt) / 1000))
    if (diff < 60) return 'aggiornato adesso'
    if (diff < 3600) return `aggiornato ${Math.floor(diff / 60)} min fa`
    if (diff < 86400) return `aggiornato ${Math.floor(diff / 3600)}h fa`
    return `aggiornato ${Math.floor(diff / 86400)} giorni fa`
  }

  function downloadJsonSnapshot() {
    if (!data) return
    const snapshot = {
      generatedAt: new Date().toISOString(),
      month: selectedMonth,
      dashboard: data,
      supplier: supplierData,
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dr7-dashboard-${selectedMonth}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Format month for display
  const formatMonth = (m: string) => {
    const [y, mo] = m.split('-')
    const months = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
    return `${months[parseInt(mo) - 1]} ${y}`
  }

  // Only show full-screen loader if we have NOTHING to display.
  // When cache is present, render it immediately + show the "Aggiorno…" badge.
  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-4 border-theme-border animate-spin" style={{ borderTopColor: '#19C2D6' }} />
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
        <button onClick={() => fetchDashboard({ force: true })} className="px-6 py-2.5 bg-[#19C2D6] text-black rounded-xl text-sm font-bold hover:bg-[#0A8FA3] transition-colors">
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
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:ring-2 focus:ring-[#19C2D6]/40 focus:border-[#19C2D6] outline-none"
            />
            <span className="text-theme-text-muted text-sm">→</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm focus:ring-2 focus:ring-[#19C2D6]/40 focus:border-[#19C2D6] outline-none"
            />
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setDateFrom(firstDayOfMonthIso()); setDateTo(lastDayOfMonthIso()) }}
                className="text-[11px] px-2 py-1 rounded border border-theme-border text-theme-text-secondary hover:text-theme-text-primary hover:border-[#19C2D6]"
                title="Mese corrente"
              >
                Mese
              </button>
              <button
                onClick={() => { const t = todayIsoRome(); setDateFrom(isoAddDays(t, -6)); setDateTo(t) }}
                className="text-[11px] px-2 py-1 rounded border border-theme-border text-theme-text-secondary hover:text-theme-text-primary hover:border-[#19C2D6]"
                title="Ultimi 7 giorni"
              >
                7g
              </button>
              <button
                onClick={() => { const t = todayIsoRome(); setDateFrom(isoAddDays(t, -29)); setDateTo(t) }}
                className="text-[11px] px-2 py-1 rounded border border-theme-border text-theme-text-secondary hover:text-theme-text-primary hover:border-[#19C2D6]"
                title="Ultimi 30 giorni"
              >
                30g
              </button>
              <button
                onClick={() => { const t = todayIsoRome(); setDateFrom(isoAddDays(t, -89)); setDateTo(t) }}
                className="text-[11px] px-2 py-1 rounded border border-theme-border text-theme-text-secondary hover:text-theme-text-primary hover:border-[#19C2D6]"
                title="Ultimi 90 giorni"
              >
                90g
              </button>
              <button
                onClick={() => { const t = todayIsoRome(); setDateFrom(`${t.substring(0, 4)}-01-01`); setDateTo(t) }}
                className="text-[11px] px-2 py-1 rounded border border-theme-border text-theme-text-secondary hover:text-theme-text-primary hover:border-[#19C2D6]"
                title="Anno corrente"
              >
                YTD
              </button>
            </div>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${loading ? 'bg-blue-500/20 text-blue-300' : 'bg-theme-bg-tertiary text-theme-text-muted'}`}>
            {loading ? 'Aggiorno…' : (cachedAt ? fmtRelative(cachedAt) : 'snapshot non disponibile')}
          </span>
          <button
            onClick={refreshAll}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded border border-theme-border text-theme-text-secondary hover:text-theme-text-primary hover:border-[#19C2D6] disabled:opacity-50"
            title="Forza aggiornamento e ri-sincronizza tutto"
          >
            ↻ Aggiorna
          </button>
          <button
            onClick={downloadJsonSnapshot}
            disabled={!data}
            className="text-xs px-3 py-1.5 rounded border border-theme-border text-theme-text-secondary hover:text-theme-text-primary hover:border-[#19C2D6] disabled:opacity-50"
            title="Scarica lo snapshot di questo mese in JSON"
          >
            Scarica snapshot
          </button>
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-theme-text-muted uppercase">Periodo</p>
            <p className="text-sm font-semibold text-theme-text-primary">{dateFrom} → {dateTo}</p>
          </div>
        </div>
      </div>

      {/* ========== KPI STRIP — 5 cards (Rentora design v1) ========== */}
      {(() => {
        // Fatturato = SINTESI di TUTTE le attività, not just noleggio.
        //   Noleggio (rental + penali + danni) — from monthly-report?type=vehicles (canonical)
        //   Lavaggi — from monthly-report?type=washes (canonical)
        //   Meccanica — from primeWash.bySource.meccanica (only place it's tracked)
        // Each piece comes from the same source the corresponding Report tab uses.
        const mr = d.monthlyReports
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const primeWash = (d as any).primeWash as { revenue?: number; bySource?: { lavaggi?: number; meccanica?: number } } | undefined
        const meccanica = primeWash?.bySource?.meccanica ?? 0
        const fatturato = mr
          ? mr.noleggio.ricavoTotale + mr.lavaggio.ricavoTotale + meccanica
          : d.revenue.currentMonth
        const incassato = d.revenue.incassato
        // If Fatturato came from canonical reports, recompute incassato % from it
        // so the sub-text matches what's shown.
        const incassatoPct = fatturato > 0 ? Math.round((incassato / fatturato) * 100) : d.revenue.incassatoPercent
        // Cash-flow from the manual Fornitori module (operator-confirmed paid).
        // Falls back to Aruba SDI invoices only if no Fornitori data yet.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fcf = (d as any).fornitoriCashFlow as
          | { pagatoMese: number; invoicePaidCount: number; daPagare: number; scaduto: number }
          | undefined
        const costiTotali = fcf?.pagatoMese ?? supplierData?.grandTotal ?? 0
        const costiCount = fcf?.invoicePaidCount ?? supplierData?.totalCount ?? 0
        const margine = Math.max(0, fatturato - costiTotali)
        const marginePct = fatturato > 0 ? Math.round((margine / fatturato) * 100) : 0
        // Stima Utile Netto: margine meno tasse ~33% (IRES 24% + IRAP ~9%).
        const TAX_RATE = 0.33
        const utileNetto = Math.round(margine * (1 - TAX_RATE) * 100) / 100

        const KpiCard = ({ title, value, trend, sub, trendDirection }: {
          title: string
          value: string
          trend?: number | null
          sub?: string
          trendDirection?: 'up-good' | 'down-good'
        }) => {
          let tColor = 'text-theme-text-muted'
          let arrow = ''
          if (typeof trend === 'number') {
            const positive = trend >= 0
            const isGood = trendDirection === 'down-good' ? !positive : positive
            tColor = isGood ? 'text-green-500' : 'text-red-500'
            arrow = positive ? '\u25B2' : '\u25BC'
          }
          const trendStr = typeof trend === 'number' ? `${arrow} ${Math.abs(trend).toFixed(1)}%` : ''
          return (
            <div className="bg-theme-bg-secondary rounded-2xl p-5 border border-theme-border shadow-sm flex flex-col gap-2 min-h-[130px]">
              <p className="text-[12px] font-semibold text-theme-text-secondary tracking-tight">{title}</p>
              <p className="text-[26px] font-bold text-theme-text-primary tracking-tight leading-tight">{value}</p>
              {(trendStr || sub) && (
                <div className="flex items-baseline gap-2 mt-auto flex-wrap">
                  {trendStr && <span className={`text-xs font-semibold ${tColor}`}>{trendStr}</span>}
                  {sub && <span className="text-[11px] text-theme-text-muted">{sub}</span>}
                </div>
              )}
            </div>
          )
        }

        return (
          <div>
            <SectionHeader title="Dashboard Proprietario / Investitore" subtitle="La situazione della tua azienda in uno sguardo" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <KpiCard title="Fatturato" value={`\u20AC ${fmt(fatturato)}`} trend={d.revenue.changePercent} trendDirection="up-good" />
              <KpiCard title="Incassato Reale" value={`\u20AC ${fmt(incassato)}`} sub={`${incassatoPct}% del fatturato`} />
              <KpiCard title="Costi Totali" value={`\u20AC ${fmtDec(costiTotali)}`} sub={`${costiCount} fatture`} />
              <KpiCard title="Margine Operativo" value={`\u20AC ${fmt(margine)}`} sub={`${marginePct}% del fatturato`} />
              <KpiCard title="Utile Netto Stimato" value={`\u20AC ${fmt(utileNetto)}`} trend={d.revenue.changePercent} trendDirection="up-good" sub="dopo tasse ~33%" />
            </div>
          </div>
        )
      })()}

      {/* ========== SINTESI DEL MESE ========== */}
      {d.monthlyReports && (() => {
        const mr = d.monthlyReports
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const primeWash = (d as any).primeWash as { revenue?: number; bySource?: { lavaggi?: number; meccanica?: number } } | undefined
        const meccanica = primeWash?.bySource?.meccanica ?? 0
        // mr.noleggio.ricavoTotale already includes rental + penali + danni
        // (it's totalRevenue from monthly-report, not just rental).
        // mr.lavaggio.ricavoTotale is car_wash only — meccanica added separately.
        const entrate =
          mr.noleggio.ricavoTotale +
          mr.lavaggio.ricavoTotale +
          meccanica
        const uscitePagate = mr.fornitori.pagatoMese
        const cashNetto = entrate - uscitePagate
        const insolutiTot = mr.penaliDanni.insolutiTotale
        const danniTot = mr.penaliDanni.danniTotale
        return (
          <div>
            <SectionHeader title="Sintesi del Mese" subtitle={`Tutte le attività del mese in un colpo d'occhio · ${d.period.month}`} />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Entrate */}
              <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-emerald-500/20">
                <p className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold mb-2">Entrate (totali attività)</p>
                <p className="text-3xl font-bold text-emerald-400 leading-tight">€ {fmtDec(entrate)}</p>
                <div className="mt-3 space-y-1 text-xs text-theme-text-muted">
                  <div className="flex justify-between"><span>Noleggio</span><span className="text-theme-text-primary">€ {fmtDec(mr.noleggio.ricavoTotale)}</span></div>
                  <div className="flex justify-between"><span>Lavaggi</span><span className="text-theme-text-primary">€ {fmtDec(mr.lavaggio.ricavoTotale)}</span></div>
                  <div className="flex justify-between"><span>Meccanica</span><span className="text-theme-text-primary">€ {fmtDec(meccanica)}</span></div>
                  <div className="flex justify-between text-[10px] text-theme-text-muted/80"><span>(di cui Penali+Danni nel Noleggio)</span><span>€ {fmtDec(insolutiTot + danniTot)}</span></div>
                  <div className="flex justify-between pt-1 border-t border-emerald-500/20 mt-1">
                    <span>Incassato</span><span className="text-emerald-300">€ {fmtDec(d.revenue.incassato)}</span>
                  </div>
                </div>
              </div>
              {/* Uscite */}
              <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-red-500/20">
                <p className="text-[10px] uppercase tracking-widest text-red-300 font-semibold mb-2">Uscite</p>
                <p className="text-3xl font-bold text-red-400 leading-tight">€ {fmtDec(uscitePagate)}</p>
                <div className="mt-3 space-y-1 text-xs text-theme-text-muted">
                  <div className="flex justify-between"><span>Pagato fornitori</span><span className="text-theme-text-primary">€ {fmtDec(mr.fornitori.pagatoMese)}</span></div>
                  <div className="flex justify-between"><span>Da pagare</span><span className="text-amber-300">€ {fmtDec(mr.fornitori.daPagare)}</span></div>
                  <div className="flex justify-between"><span>Scaduto</span><span className={mr.fornitori.scaduto > 0 ? 'text-red-300' : 'text-theme-text-primary'}>€ {fmtDec(mr.fornitori.scaduto)}</span></div>
                  <div className="flex justify-between pt-1 border-t border-red-500/20 mt-1">
                    <span>Alert aperti</span><span className={mr.fornitori.alertsOpen > 0 ? 'text-amber-300' : 'text-theme-text-primary'}>{mr.fornitori.alertsOpen}</span>
                  </div>
                </div>
              </div>
              {/* Cash netto */}
              <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-[#19C2D6]/20">
                <p className="text-[10px] uppercase tracking-widest text-[#19C2D6] font-semibold mb-2">Cash Netto</p>
                <p className={`text-3xl font-bold leading-tight ${cashNetto >= 0 ? 'text-[#19C2D6]' : 'text-red-400'}`}>€ {fmtDec(cashNetto)}</p>
                <p className="text-xs text-theme-text-muted mt-1">Entrate − Uscite (cash flow)</p>
                <div className="mt-3 space-y-1 text-xs text-theme-text-muted">
                  <div className="flex justify-between"><span>Fatturato</span><span className="text-theme-text-primary">€ {fmtDec(d.revenue.currentMonth)}</span></div>
                  <div className="flex justify-between"><span>Costi totali</span><span className="text-theme-text-primary">€ {fmtDec(uscitePagate)}</span></div>
                  <div className="flex justify-between"><span>Margine</span><span className="text-theme-text-primary">€ {fmtDec(d.revenue.currentMonth - uscitePagate)}</span></div>
                  <div className="flex justify-between pt-1 border-t border-[#19C2D6]/20 mt-1">
                    <span>vs mese scorso</span>
                    <Trend value={d.revenue.changePercent} size="sm" />
                  </div>
                </div>
              </div>
            </div>

            {/* Second row — operations / customers / risks */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
              {/* Operatività */}
              <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-blue-500/20">
                <p className="text-[10px] uppercase tracking-widest text-blue-300 font-semibold mb-2">Operatività</p>
                <p className="text-3xl font-bold text-blue-400 leading-tight">{d.fleet.occupationRate}%</p>
                <p className="text-xs text-theme-text-muted mt-1">Occupazione flotta</p>
                <div className="mt-3 space-y-1 text-xs text-theme-text-muted">
                  <div className="flex justify-between"><span>Prenotazioni</span><span className="text-theme-text-primary">{mr.noleggio.prenotazioniCount}</span></div>
                  <div className="flex justify-between"><span>Annullate</span><span className={mr.noleggio.prenotazioniAnnullateCount > 0 ? 'text-amber-300' : 'text-theme-text-primary'}>{mr.noleggio.prenotazioniAnnullateCount} (€ {fmtDec(mr.noleggio.prenotazioniAnnullateValue)})</span></div>
                  <div className="flex justify-between"><span>Lavaggi</span><span className="text-theme-text-primary">{mr.lavaggio.count}</span></div>
                  <div className="flex justify-between pt-1 border-t border-blue-500/20 mt-1">
                    <span>Conversion bookings</span><span className="text-theme-text-primary">{d.bookings.conversionRate}%</span>
                  </div>
                </div>
              </div>

              {/* Clienti & Preventivi */}
              <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-purple-500/20">
                <p className="text-[10px] uppercase tracking-widest text-purple-300 font-semibold mb-2">Clienti</p>
                <p className="text-3xl font-bold text-purple-400 leading-tight">+{mr.clienti.nuoviMese}</p>
                <p className="text-xs text-theme-text-muted mt-1">Nuovi clienti nel mese</p>
                <div className="mt-3 space-y-1 text-xs text-theme-text-muted">
                  <div className="flex justify-between"><span>Attivi nel mese</span><span className="text-theme-text-primary">{mr.clienti.attiviMese}</span></div>
                  <div className="flex justify-between"><span>Totale clienti</span><span className="text-theme-text-primary">{fmt(mr.clienti.totale)}</span></div>
                  <div className="flex justify-between"><span>Preventivi</span><span className="text-theme-text-primary">{mr.preventivi.total}</span></div>
                  <div className="flex justify-between pt-1 border-t border-purple-500/20 mt-1">
                    <span>Conversion preventivi</span>
                    <span className={mr.preventivi.conversionRate >= 50 ? 'text-emerald-300' : 'text-amber-300'}>{mr.preventivi.conversionRate}%</span>
                  </div>
                </div>
              </div>

              {/* Rischi & Alert */}
              <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-amber-500/20">
                <p className="text-[10px] uppercase tracking-widest text-amber-300 font-semibold mb-2">Rischi & Alert</p>
                <p className={`text-3xl font-bold leading-tight ${(insolutiTot + danniTot + mr.fornitori.scaduto) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>€ {fmtDec(insolutiTot + danniTot + mr.fornitori.scaduto)}</p>
                <p className="text-xs text-theme-text-muted mt-1">Insoluti + Danni + Scaduto fornitori</p>
                <div className="mt-3 space-y-1 text-xs text-theme-text-muted">
                  <div className="flex justify-between"><span>Insoluti</span><span className={insolutiTot > 0 ? 'text-amber-300' : 'text-theme-text-primary'}>€ {fmtDec(insolutiTot)} ({mr.penaliDanni.insolutiCount})</span></div>
                  <div className="flex justify-between"><span>Danni</span><span className={danniTot > 0 ? 'text-red-300' : 'text-theme-text-primary'}>€ {fmtDec(danniTot)} ({mr.penaliDanni.danniCount})</span></div>
                  <div className="flex justify-between"><span>Scaduto fornitori</span><span className={mr.fornitori.scaduto > 0 ? 'text-red-300' : 'text-theme-text-primary'}>€ {fmtDec(mr.fornitori.scaduto)}</span></div>
                  <div className="flex justify-between pt-1 border-t border-amber-500/20 mt-1">
                    <span>Anomalie aperte</span><span className={mr.fornitori.alertsOpen > 0 ? 'text-amber-300' : 'text-theme-text-primary'}>{mr.fornitori.alertsOpen}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ========== REPORT PREVENTIVI (Overview / Domanda / Conversione / Perdite / Azioni) ========== */}
      {d.monthlyReports && (() => {
        const p = d.monthlyReports.preventivi
        const hasAnalytics = (p.topVehicles?.length ?? 0) > 0 || (p.topPeriodi?.length ?? 0) > 0 || (p.topPerdite?.length ?? 0) > 0 || (p.azioniSuggerite?.length ?? 0) > 0
        if (p.total === 0 && !hasAnalytics) return null
        const monthLabel = d.period.month
        return (
          <div>
            <SectionHeader title="Report Preventivi" subtitle={`Analisi domanda → conversione → perdite · ${monthLabel} (esclusi operatori test)`} />

            {/* 1. OVERVIEW */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <StatCard label="Preventivi totali" value={String(p.total)} />
              <StatCard label="Salvati" value={String(p.salvati ?? 0)} sub="bozza · inviato" />
              <StatCard label="Convertiti" value={String(p.accettati)} accent="green" />
              <StatCard label="Rifiutati" value={String(p.rifiutatiCount)} sub={`${p.scadutiCount ?? 0} scaduti`} accent="red" />
              <StatCard label="Conversion rate" value={`${p.conversionRate}%`} accent={p.conversionRate >= 30 ? 'green' : p.conversionRate >= 15 ? 'orange' : 'red'} />
              <StatCard label="Valore perso" value={`€ ${fmtDec(p.valorePotenzialePerso ?? 0)}`} sub="potenziale" accent="orange" />
            </div>

            {/* 2. DOMANDA + 3. CONVERSIONE side-by-side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
              {/* DOMANDA */}
              <div className="bg-theme-bg-secondary/60 rounded-xl p-5 border border-blue-500/20">
                <h4 className="text-sm font-bold text-blue-300 uppercase tracking-wide mb-3">Domanda</h4>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-theme-text-muted uppercase mb-1">Top veicoli richiesti</p>
                    {(p.topVehicles ?? []).slice(0, 5).length === 0 ? (
                      <p className="text-xs text-theme-text-muted italic">Nessun dato</p>
                    ) : (p.topVehicles ?? []).slice(0, 5).map((v, i) => (
                      <div key={i} className="flex justify-between items-center py-1 text-xs">
                        <span className="text-theme-text-primary truncate pr-2">{v.vehicle}</span>
                        <span className="text-theme-text-muted whitespace-nowrap">{v.count} richieste</span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-3 border-t border-theme-border">
                    <p className="text-xs text-theme-text-muted uppercase mb-1">Top periodi (mese pickup)</p>
                    {(p.topPeriodi ?? []).slice(0, 5).length === 0 ? (
                      <p className="text-xs text-theme-text-muted italic">Nessun dato</p>
                    ) : (p.topPeriodi ?? []).slice(0, 5).map((per, i) => (
                      <div key={i} className="flex justify-between items-center py-1 text-xs">
                        <span className="text-theme-text-primary">{per.periodo}</span>
                        <span className="text-theme-text-muted">{per.count} preventivi</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* CONVERSIONE */}
              <div className="bg-theme-bg-secondary/60 rounded-xl p-5 border border-emerald-500/20">
                <h4 className="text-sm font-bold text-emerald-300 uppercase tracking-wide mb-3">Conversione</h4>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-theme-text-muted uppercase mb-1">Per veicolo (richieste → prenotazioni)</p>
                    {(p.topVehicles ?? []).slice(0, 5).length === 0 ? (
                      <p className="text-xs text-theme-text-muted italic">Nessun dato</p>
                    ) : (p.topVehicles ?? []).slice(0, 5).map((v, i) => (
                      <div key={i} className="flex justify-between items-center py-1 text-xs">
                        <span className="text-theme-text-primary truncate pr-2">{v.vehicle}</span>
                        <span className="text-theme-text-muted whitespace-nowrap">
                          {v.converted}/{v.count} ·
                          <span className={`ml-1 font-semibold ${v.conversionRate >= 30 ? 'text-emerald-300' : v.conversionRate >= 15 ? 'text-amber-300' : 'text-red-300'}`}>
                            {v.conversionRate}%
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-3 border-t border-theme-border">
                    <p className="text-xs text-theme-text-muted uppercase mb-1">Per fascia prezzo</p>
                    {(p.fasceConversione ?? []).length === 0 ? (
                      <p className="text-xs text-theme-text-muted italic">Nessun dato</p>
                    ) : (p.fasceConversione ?? []).map((f, i) => (
                      <div key={i} className="flex justify-between items-center py-1 text-xs">
                        <span className="text-theme-text-primary">€ {f.range}</span>
                        <span className="text-theme-text-muted whitespace-nowrap">
                          {f.converted}/{f.total} ·
                          <span className={`ml-1 font-semibold ${f.conversionRate >= 30 ? 'text-emerald-300' : f.conversionRate >= 15 ? 'text-amber-300' : 'text-red-300'}`}>
                            {f.conversionRate}%
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 4. PERDITE */}
            <div className="bg-theme-bg-secondary/60 rounded-xl p-5 border border-red-500/20 mt-3">
              <h4 className="text-sm font-bold text-red-300 uppercase tracking-wide mb-3">Perdite — preventivi non convertiti</h4>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                {/* Top non convertiti */}
                <div className="lg:col-span-2">
                  <p className="text-theme-text-muted uppercase mb-2">Top per valore</p>
                  {(p.topPerdite ?? []).length === 0 ? (
                    <p className="text-theme-text-muted italic">Nessun preventivo perso</p>
                  ) : (p.topPerdite ?? []).map((l, i) => (
                    <div key={i} className="flex justify-between items-start py-1.5 border-b border-theme-border last:border-0">
                      <div className="flex-1 pr-3">
                        <p className="text-theme-text-primary font-medium truncate">{l.vehicle}</p>
                        <p className="text-theme-text-muted">
                          {l.pickup ? new Date(l.pickup).toLocaleDateString('it-IT') : '?'}
                          {l.dropoff && ` → ${new Date(l.dropoff).toLocaleDateString('it-IT')}`}
                          {l.days && ` · ${l.days}gg`}
                          {l.motivo && ` · motivo: ${l.motivo}`}
                        </p>
                      </div>
                      <span className="text-red-300 font-semibold whitespace-nowrap">€ {fmtDec(l.value)}</span>
                    </div>
                  ))}
                </div>
                {/* Motivo abbandono */}
                <div>
                  <p className="text-theme-text-muted uppercase mb-2">Motivo (rifiutati)</p>
                  <div className="space-y-1">
                    <div className="flex justify-between"><span>Cauzione</span><span className="text-theme-text-primary">{p.motivoCounts.cauzione}</span></div>
                    <div className="flex justify-between"><span>Prezzo</span><span className="text-theme-text-primary">{p.motivoCounts.prezzo}</span></div>
                    <div className="flex justify-between"><span>Non specificato</span><span className="text-theme-text-muted">{p.motivoCounts.non_specificato}</span></div>
                    <div className="flex justify-between pt-1 border-t border-theme-border mt-1">
                      <span>Scaduti (timeout)</span><span className="text-amber-300">{p.scadutiCount ?? 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 5. AZIONI SUGGERITE */}
            {(p.azioniSuggerite ?? []).length > 0 && (
              <div className="bg-amber-500/5 rounded-xl p-5 border border-amber-500/30 mt-3">
                <h4 className="text-sm font-bold text-amber-300 uppercase tracking-wide mb-3">Azioni Suggerite</h4>
                <ul className="space-y-2">
                  {(p.azioniSuggerite ?? []).map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-theme-text-primary">
                      <span className="text-amber-400 mt-0.5">→</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })()}

      {/* ========== OCCUPAZIONE FLOTTA ========== */}
      <div>
        <SectionHeader title="Occupazione Flotta" subtitle="Stai sfruttando bene le tue auto?" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Gauge + counts */}
          <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-xl p-5 border border-white/5 flex flex-col items-center">
            <div className="relative">
              <CircularGauge value={d.fleet.occupationRate} size={130} strokeWidth={12} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-[#19C2D6]">{d.fleet.occupationRate}%</span>
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
                <div className="h-full bg-[#19C2D6] rounded-full transition-all duration-1000" style={{ width: `${d.fleet.occupationRate}%` }} />
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
            <span className="text-3xl font-bold text-[#19C2D6]">{'\u20AC'} {fmtDec(d.revenuePerVehicle.avgPerDay)}</span>
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
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? 'bg-[#19C2D6] text-black' : 'bg-white/10 text-theme-text-muted'}`}>
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
            <span className="text-3xl font-bold text-[#19C2D6]">{d.bookings.total}</span>
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
              <p className="text-lg font-bold text-[#19C2D6]">{d.bookings.conversionRate}% <span className="text-xs font-normal text-theme-text-muted">({conversionLabel})</span></p>
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

      {/* ========== RIASSUNTO MENSILE PER REPORT ========== */}
      {d.monthlyReports && (
        <div>
          <SectionHeader title="Riassunto Mensile per Report" subtitle="Stessi numeri dei tab Report — clicca su una card per i dettagli" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* NOLEGGIO */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: d.monthlyReports!.noleggio.link } }))}
              className="text-left bg-theme-bg-secondary/60 rounded-2xl p-4 border border-theme-border hover:border-[#19C2D6]/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-widest text-theme-text-muted font-semibold">Noleggio</p>
                <span className="text-theme-text-muted text-xs group-hover:text-[#19C2D6]">Apri →</span>
              </div>
              <p className="text-2xl font-bold text-[#19C2D6]">€ {fmtDec(d.monthlyReports.noleggio.ricavoTotale)}</p>
              <p className="text-xs text-theme-text-muted mt-1">{d.monthlyReports.noleggio.prenotazioniCount} prenotazioni · {d.monthlyReports.noleggio.prenotazioniAnnullateCount} annullate (€ {fmtDec(d.monthlyReports.noleggio.prenotazioniAnnullateValue)})</p>
            </button>

            {/* LAVAGGIO */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: d.monthlyReports!.lavaggio.link } }))}
              className="text-left bg-theme-bg-secondary/60 rounded-2xl p-4 border border-theme-border hover:border-blue-400/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-widest text-theme-text-muted font-semibold">Lavaggio</p>
                <span className="text-theme-text-muted text-xs group-hover:text-blue-400">Apri →</span>
              </div>
              <p className="text-2xl font-bold text-blue-400">€ {fmtDec(d.monthlyReports.lavaggio.ricavoTotale)}</p>
              <p className="text-xs text-theme-text-muted mt-1">{d.monthlyReports.lavaggio.count} lavaggi nel mese</p>
            </button>

            {/* CLIENTI */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: d.monthlyReports!.clienti.link } }))}
              className="text-left bg-theme-bg-secondary/60 rounded-2xl p-4 border border-theme-border hover:border-emerald-400/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-widest text-theme-text-muted font-semibold">Clienti</p>
                <span className="text-theme-text-muted text-xs group-hover:text-emerald-400">Apri →</span>
              </div>
              <p className="text-2xl font-bold text-emerald-400">+{d.monthlyReports.clienti.nuoviMese}</p>
              <p className="text-xs text-theme-text-muted mt-1">{d.monthlyReports.clienti.attiviMese} attivi nel mese · {fmt(d.monthlyReports.clienti.totale)} totali</p>
            </button>

            {/* PENALI & DANNI */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: d.monthlyReports!.penaliDanni.link } }))}
              className="text-left bg-theme-bg-secondary/60 rounded-2xl p-4 border border-theme-border hover:border-red-400/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-widest text-theme-text-muted font-semibold">Penali & Danni</p>
                <span className="text-theme-text-muted text-xs group-hover:text-red-400">Apri →</span>
              </div>
              <p className="text-2xl font-bold text-red-400">€ {fmtDec(d.monthlyReports.penaliDanni.danniTotale + d.monthlyReports.penaliDanni.insolutiTotale)}</p>
              <p className="text-xs text-theme-text-muted mt-1">{d.monthlyReports.penaliDanni.danniCount} danni · {d.monthlyReports.penaliDanni.insolutiCount} insoluti</p>
            </button>

            {/* PREVENTIVI */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: d.monthlyReports!.preventivi.link } }))}
              className="text-left bg-theme-bg-secondary/60 rounded-2xl p-4 border border-theme-border hover:border-amber-400/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-widest text-theme-text-muted font-semibold">Preventivi</p>
                <span className="text-theme-text-muted text-xs group-hover:text-amber-400">Apri →</span>
              </div>
              <p className="text-2xl font-bold text-amber-400">{d.monthlyReports.preventivi.total}</p>
              <p className="text-xs text-theme-text-muted mt-1">
                {d.monthlyReports.preventivi.accettati} accettati ({d.monthlyReports.preventivi.conversionRate}%) · {d.monthlyReports.preventivi.rifiutatiCount} rifiutati
                {d.monthlyReports.preventivi.rifiutatiCount > 0 && ` (cauzione ${d.monthlyReports.preventivi.motivoCounts.cauzione} · prezzo ${d.monthlyReports.preventivi.motivoCounts.prezzo})`}
              </p>
            </button>

            {/* FORNITORI */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: d.monthlyReports!.fornitori.link } }))}
              className="text-left bg-theme-bg-secondary/60 rounded-2xl p-4 border border-theme-border hover:border-purple-400/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-widest text-theme-text-muted font-semibold">Fornitori</p>
                <span className="text-theme-text-muted text-xs group-hover:text-purple-400">Apri →</span>
              </div>
              <p className="text-2xl font-bold text-purple-400">€ {fmtDec(d.monthlyReports.fornitori.daPagare)}</p>
              <p className="text-xs text-theme-text-muted mt-1">
                Da pagare · pagato € {fmtDec(d.monthlyReports.fornitori.pagatoMese)}
                {d.monthlyReports.fornitori.alertsOpen > 0 && ` · ${d.monthlyReports.fornitori.alertsOpen} alert`}
              </p>
            </button>
          </div>
        </div>
      )}

      {/* ========== FATTURATO DEL MESE (era "Cash Flow") ========== */}
      <div>
        <SectionHeader title="Fatturato del Mese" subtitle="Tutte le prenotazioni del mese — pagate, da incassare e scadute" />
        {/* Totale fatturato \u2014 TUTTO il mese, indipendentemente dallo stato pagamento */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <StatCard
            label="Totale Fatturato Mese"
            value={`\u20AC ${fmt(d.revenue.currentMonth)}`}
            sub={`Incassato + da incassare (tutte le prenotazioni valide di ${formatMonth(selectedMonth)})`}
            accent="gold"
            border
          />
          <StatCard
            label="Mese precedente"
            value={`\u20AC ${fmt(d.revenue.previousMonth)}`}
            trend={d.revenue.changePercent}
            accent="default"
            border
          />
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <StatCard label="Incassato" value={`\u20AC ${fmt(d.cashFlow.incassato)}`} sub="Cassa effettiva" accent="green" border />
          <StatCard label="Da Incassare" value={`\u20AC ${fmt(d.cashFlow.daIncassare)}`} sub="Pending / da saldare" accent="orange" border />
          <StatCard label="Scaduti" value={`\u20AC ${fmt(d.cashFlow.insolutiScaduti)}`} sub="Non pagati oltre scadenza" accent="red" border />
        </div>

        {/* Visibility on what's intentionally NOT in fatturato */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatCard
            label="Annullate del mese"
            value={`\u20AC ${fmt(d.revenue.cancelledRentalsTotal || 0)}`}
            sub={`${d.revenue.cancelledRentalsCount || 0} prenotazioni cancellate (non in fatturato)`}
            accent="red"
            border
          />
          <StatCard
            label="Lavaggi del mese"
            value={`\u20AC ${fmt(d.revenue.washTotal || 0)}`}
            sub={`${d.revenue.washCount || 0} lavaggi (rendiconto separato)`}
            accent="blue"
            border
          />
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

      {/* ========== FORNITORI CASH FLOW (manual module — source of truth) ========== */}
      {(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fcf = (d as any).fornitoriCashFlow as {
          pagatoMese: number; pagatoMesePrev: number; changePercent: number
          daPagare: number; daPagareCount: number
          scaduto: number; scadutoCount: number
          invoicePaidCount: number; activeFornitoriCount: number
          bySupplier: Array<{ nome: string; total: number; count: number }>
          byCategoria: Array<{ categoria: string; total: number }>
          alertsOpen: number
        } | undefined
        if (!fcf) return null
        const margineNetto = Math.max(0, d.revenue.currentMonth - fcf.pagatoMese)
        const trend = fcf.changePercent
        return (
          <div>
            <SectionHeader title="Fornitori — Cash Flow" subtitle="Pagamenti effettivi dal modulo Fornitori (data_pagamento)" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="bg-theme-bg-secondary/60 rounded-2xl p-4 border border-white/5">
                <p className="text-xs text-theme-text-muted uppercase tracking-wide">Pagato nel mese</p>
                <p className="text-xl font-semibold text-theme-text-primary mt-1">€ {fmtDec(fcf.pagatoMese)}</p>
                <p className="text-xs text-theme-text-muted mt-1">
                  {fcf.invoicePaidCount} fatture · {trend >= 0 ? '+' : ''}{trend}% vs mese prec.
                </p>
              </div>
              <div className="bg-theme-bg-secondary/60 rounded-2xl p-4 border border-white/5">
                <p className="text-xs text-theme-text-muted uppercase tracking-wide">Da Pagare</p>
                <p className="text-xl font-semibold text-amber-400 mt-1">€ {fmtDec(fcf.daPagare)}</p>
                <p className="text-xs text-theme-text-muted mt-1">{fcf.daPagareCount} fatture aperte</p>
              </div>
              <div className="bg-theme-bg-secondary/60 rounded-2xl p-4 border border-white/5">
                <p className="text-xs text-theme-text-muted uppercase tracking-wide">Scaduto</p>
                <p className={`text-xl font-semibold mt-1 ${fcf.scaduto > 0 ? 'text-red-400' : 'text-theme-text-primary'}`}>€ {fmtDec(fcf.scaduto)}</p>
                <p className="text-xs text-theme-text-muted mt-1">{fcf.scadutoCount} fatture scadute</p>
              </div>
              <div className="bg-theme-bg-secondary/60 rounded-2xl p-4 border border-white/5">
                <p className="text-xs text-theme-text-muted uppercase tracking-wide">Margine Netto Cash</p>
                <p className="text-xl font-semibold text-emerald-400 mt-1">€ {fmtDec(margineNetto)}</p>
                <p className="text-xs text-theme-text-muted mt-1">Fatturato − Pagato</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAlertDetails(v => !v)}
                className="bg-theme-bg-secondary/60 rounded-2xl p-4 border border-white/5 text-left hover:border-amber-500/30 transition-colors"
                title="Clicca per vedere i dettagli degli alert"
              >
                <p className="text-xs text-theme-text-muted uppercase tracking-wide flex items-center justify-between">
                  Alert Fornitori
                  <span className="text-theme-text-muted text-[10px]">{showAlertDetails ? '▲' : '▼'}</span>
                </p>
                <p className={`text-xl font-semibold mt-1 ${fcf.alertsOpen > 0 ? 'text-amber-400' : 'text-theme-text-primary'}`}>{fcf.alertsOpen}</p>
                <p className="text-xs text-theme-text-muted mt-1">{fcf.activeFornitoriCount} fornitori attivi · clicca per dettagli</p>
              </button>
            </div>

            {/* Alert details panel — opens below the FORNITORI grid */}
            {showAlertDetails && (
              <div className="mt-3 bg-amber-500/5 border border-amber-500/30 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-amber-300">Dettaglio Alert Fornitori</p>
                  <button
                    onClick={() => setShowAlertDetails(false)}
                    className="text-xs text-theme-text-muted hover:text-theme-text-primary"
                  >
                    Chiudi ×
                  </button>
                </div>
                {alertDetailsLoading && (
                  <p className="text-xs text-theme-text-muted">Caricamento alert…</p>
                )}
                {!alertDetailsLoading && alertDetails && alertDetails.length === 0 && (
                  <p className="text-xs text-theme-text-muted">Nessun alert aperto al momento.</p>
                )}
                {!alertDetailsLoading && alertDetails && alertDetails.length > 0 && (
                  <ul className="space-y-2">
                    {alertDetails.map(a => (
                      <li key={a.id} className="bg-theme-bg-secondary/60 rounded-lg p-3 border border-theme-border">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                a.severity === 'error' ? 'bg-red-500/20 text-red-300'
                                  : a.severity === 'warning' ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-blue-500/20 text-blue-300'
                              }`}>{a.severity}</span>
                              <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">{a.tipo.replace(/_/g, ' ')}</span>
                              <span className="text-theme-text-primary font-semibold text-sm">{a.fornitore_nome}</span>
                            </div>
                            <p className="text-sm text-theme-text-secondary">{a.messaggio}</p>
                          </div>
                          <span className="text-[10px] text-theme-text-muted whitespace-nowrap">
                            {new Date(a.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {(fcf.bySupplier.length > 0 || fcf.byCategoria.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
                {fcf.bySupplier.length > 0 && (
                  <div className="bg-theme-bg-secondary/60 rounded-2xl p-4 border border-white/5">
                    <p className="text-xs text-theme-text-muted uppercase tracking-wide mb-2">Top Fornitori (pagato nel mese)</p>
                    <div className="space-y-1.5">
                      {fcf.bySupplier.slice(0, 5).map((s, i) => (
                        <div key={i} className="flex justify-between items-center text-sm">
                          <span className="text-theme-text-primary truncate pr-3">{s.nome}</span>
                          <span className="text-theme-text-muted whitespace-nowrap">€ {fmtDec(s.total)} · {s.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {fcf.byCategoria.length > 0 && (
                  <div className="bg-theme-bg-secondary/60 rounded-2xl p-4 border border-white/5">
                    <p className="text-xs text-theme-text-muted uppercase tracking-wide mb-2">Spesa per Categoria</p>
                    <div className="space-y-1.5">
                      {fcf.byCategoria.map((c, i) => (
                        <div key={i} className="flex justify-between items-center text-sm">
                          <span className="text-theme-text-primary capitalize">{c.categoria.replace(/_/g, ' ')}</span>
                          <span className="text-theme-text-muted whitespace-nowrap">€ {fmtDec(c.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* ========== COSTI FORNITORI (Aruba SDI — secondary, for reconciliation) ========== */}
      <div>
        <SectionHeader title="Fatture SDI Ricevute" subtitle="Fatture passive ricevute via Aruba SDI (riconciliazione)" />

        {supplierLoading && (
          <div className="bg-theme-bg-secondary/60 rounded-2xl p-6 border border-white/5 text-center">
            <p className="text-theme-text-muted text-sm">Caricamento fatture fornitori...</p>
          </div>
        )}

        {!supplierLoading && supplierData && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                label="Totale Costi Mese"
                value={`\u20AC ${fmtDec(supplierData.grandTotal)}`}
                sub={`${supplierData.totalCount} fatture ricevute`}
                accent="red"
                border
              />
              <StatCard
                label="Fornitori Attivi"
                value={String(Object.keys(supplierData.supplierTotals).length)}
                sub={`su 9 monitorati`}
                accent="default"
                border
              />
              {d && (
                <StatCard
                  label="Margine Operativo"
                  value={`\u20AC ${fmt(Math.round(d.revenue.currentMonth - supplierData.grandTotal))}`}
                  sub={`Fatturato \u20AC ${fmt(d.revenue.currentMonth)} - Costi \u20AC ${fmt(Math.round(supplierData.grandTotal))}`}
                  accent={d.revenue.currentMonth - supplierData.grandTotal > 0 ? 'green' : 'red'}
                  border
                />
              )}
            </div>

            {/* Supplier breakdown table */}
            <div className="bg-theme-bg-secondary/60 backdrop-blur-sm rounded-2xl border border-white/5 overflow-hidden">
              <button
                onClick={() => setSupplierExpanded(!supplierExpanded)}
                className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-sm font-semibold text-theme-text-primary uppercase tracking-wide">Dettaglio per Fornitore</span>
                <svg className={`w-4 h-4 text-theme-text-muted transition-transform ${supplierExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {supplierExpanded && (
                <div className="border-t border-white/5">
                  {Object.entries(supplierData.supplierTotals)
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([supplier, info]) => (
                      <div key={supplier} className="border-b border-white/5 last:border-b-0">
                        <button
                          onClick={() => setSupplierDetailOpen(supplierDetailOpen === supplier ? null : supplier)}
                          className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                              <span className="text-red-400 text-xs font-bold">{info.count}</span>
                            </div>
                            <span className="text-sm text-theme-text-primary truncate">{supplier}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-red-400">{'\u20AC'} {fmtDec(info.total)}</span>
                            <svg className={`w-3.5 h-3.5 text-theme-text-muted transition-transform ${supplierDetailOpen === supplier ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>

                        {/* Expanded invoice list for this supplier */}
                        {supplierDetailOpen === supplier && (
                          <div className="px-5 pb-3 space-y-1.5">
                            {supplierData.invoices
                              .filter(inv => inv.sender === supplier)
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              .map((inv: any, idx: number) => (
                                <div key={inv.id || idx} className="flex items-center justify-between bg-white/[0.02] rounded-lg px-3 py-2">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <span className="text-xs text-theme-text-muted w-20 flex-shrink-0">
                                      {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('it-IT') : '—'}
                                    </span>
                                    <span className="text-xs text-theme-text-secondary truncate">
                                      {inv.invoiceNumber || 'N/A'}
                                    </span>
                                  </div>
                                  <span className="text-xs font-mono text-theme-text-primary flex-shrink-0">{'\u20AC'} {fmtDec(inv.amount)}</span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}

                  {Object.keys(supplierData.supplierTotals).length === 0 && (
                    <div className="px-5 py-8 text-center text-theme-text-muted text-sm">
                      Nessuna fattura fornitore trovata per questo mese
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!supplierLoading && supplierError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center">
            <p className="text-red-400 font-medium text-sm mb-1">Errore caricamento fatture fornitori</p>
            <p className="text-theme-text-muted text-xs">{supplierError}</p>
            <button onClick={() => fetchSupplierCosts(selectedMonth)} className="mt-3 px-4 py-1.5 bg-[#19C2D6] text-black rounded-lg text-xs font-bold hover:bg-[#0A8FA3] transition-colors">
              Riprova
            </button>
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
