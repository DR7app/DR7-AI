import { useState, useEffect, useCallback } from 'react'
import { ScheletroPagina, ScheletroTabella, ScheletroTesto } from '../../../components/Scheletro'
import { ReportCard, ReportTable, ReportRow, ReportTotalRow } from './ReportUI'
import { authFetch } from '../../../utils/authFetch'
import { supabase } from '../../../supabaseClient'
import DashboardOverview from './DashboardOverview'

/**
 * Le stesse cifre che il Report Noleggio mostra in cima.
 * 2026-08-27 (richiesta direzione): il Dashboard leggeva solo `ricavoTotale` e
 * restava sempre sotto al Report, che somma anche l'anticipato e il da saldare.
 */
interface BusinessReport {
  /** Incassato del periodo: noleggio + penali + danni. */
  ricavoTotale: number
  /** Gia' incassato ma riferito a noleggi futuri. */
  ricavoAnticipato?: number
  /** Ancora da incassare. */
  daSaldare?: number
  /** Card "Ricavo TOTALE" del Report: incassato + anticipato. */
  ricavoConAnticipato?: number
  /** Card "Totale Complessivo" del Report: incassato + anticipato + da saldare. */
  totaleComplessivo?: number
  prenotazioniCount: number
  canonical: boolean
}

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
    /** 2026-08-24: Mare, Aria e Soggiorni mancavano del tutto dalle Entrate. */
    mare?: BusinessReport
    aria?: BusinessReport
    soggiorni?: BusinessReport
    noleggio: BusinessReport & { ricavoMesePrev: number; ricavoChangePercent: number; prenotazioniAnnullateCount: number; prenotazioniAnnullateValue: number; link: string; ricavoNoleggioPuro?: number | null; ricavoPenali?: number | null; ricavoDanni?: number | null }
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

// 2026-08-27 (richiesta direzione): gli importi in € vanno SEMPRE al centesimo
// (fmtDec). `fmt` resta per i conteggi — clienti, prenotazioni, fatture.
// Arrotondando all'euro il Totale Complessivo del Dashboard non coincideva con
// quello del Report Terra e sembrava un numero diverso.
function fmt(n: number): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDec(n: number): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// SVG circular gauge
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
      <h3 className="text-base font-bold text-theme-text-primary">{title}</h3>
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
function StatCard({ label, value, sub, trend, trendSuffix, trendInvert, accent }: {
  label: string; value: string; sub?: string; trend?: number; trendSuffix?: string; trendInvert?: boolean
  accent?: 'gold' | 'green' | 'red' | 'orange' | 'blue' | 'default'
}) {
  const accentColors: Record<string, string> = {
    gold: 'text-dr7-gold', green: 'text-green-500', red: 'text-red-500',
    orange: 'text-yellow-400', blue: 'text-theme-text-primary', default: 'text-theme-text-primary'
  }
  const valueColor = accentColors[accent || 'default']
  return (
    <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
      <p className="text-xs text-theme-text-muted">{label}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="text-[10px] text-theme-text-muted mt-0.5">{sub}</p>}
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
// All YYYY-MM calendar months touched by the [from,to] range, inclusive.
// Aruba passive-invoice fetch is month-bucketed, so the supplier panel sums
// across every month the selected range spans.
function monthsInRange(from: string, to: string): string[] {
  const months: string[] = []
  let y = parseInt(from.substring(0, 4)), m = parseInt(from.substring(5, 7))
  const ey = parseInt(to.substring(0, 4)), em = parseInt(to.substring(5, 7))
  let guard = 0
  while ((y < ey || (y === ey && m <= em)) && guard++ < 120) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return months
}
// Format an ISO date (YYYY-MM-DD) as Italian DD/MM/YYYY.
function fmtItalianDate(iso: string): string {
  if (!iso || iso.length < 10) return iso || ''
  return `${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.substring(0, 4)}`
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

  const fetchSupplierCosts = useCallback(async (from: string, to: string, opts?: { useCache?: boolean }) => {
    const cacheKey = `${SUPPLIER_CACHE_PREFIX}:${from}_${to}`
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
      // Aruba invoices are month-bucketed — fetch every month the range spans
      // and merge into one range-wide payload.
      const months = monthsInRange(from, to)
      const results = await Promise.all(months.map(async (mo) => {
        const res = await authFetch(`/.netlify/functions/get-incoming-invoices?month=${mo}`)
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
        return json
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const merged: any = { success: true, invoices: [], supplierTotals: {}, grandTotal: 0, totalCount: 0 }
      for (const json of results) {
        if (Array.isArray(json.invoices)) merged.invoices.push(...json.invoices)
        const st = json.supplierTotals || {}
        for (const name of Object.keys(st)) {
          const agg = st[name] || { count: 0, total: 0 }
          const cur = merged.supplierTotals[name] || { count: 0, total: 0 }
          cur.count += agg.count || 0
          cur.total += agg.total || 0
          merged.supplierTotals[name] = cur
        }
        merged.grandTotal += Number(json.grandTotal) || 0
        merged.totalCount += Number(json.totalCount) || 0
      }
      setSupplierData(merged)
      writeCache(cacheKey, merged)
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
    fetchSupplierCosts(dateFrom, dateTo, { useCache: true })
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
    fetchSupplierCosts(dateFrom, dateTo, { useCache: false })
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

  // Only show full-screen loader if we have NOTHING to display.
  // When cache is present, render it immediately + show the "Aggiorno…" badge.
  if (loading && !data) {
    return (
      <ScheletroPagina card={4} righe={6} colonne={4} />
    )
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-8 text-center max-w-md mx-auto mt-12">
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
  // Italian-formatted label for the currently selected period (DD/MM/YYYY → DD/MM/YYYY).
  const periodLabel = `${fmtItalianDate(dateFrom)} → ${fmtItalianDate(dateTo)}`

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">

      {/* ========== OVERVIEW (KPI strip + charts) ========== */}
      <DashboardOverview dateFrom={dateFrom} dateTo={dateTo} />

      {/* ========== HEADER ========== */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-xl font-bold text-theme-text-primary tracking-wide">DASHBOARD PROPRIETARIO</h2>
          <p className="text-xs text-theme-text-muted mt-0.5">La visione strategica della tua azienda</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Italian-formatted date field — the native picker is overlaid
                transparently so the OS calendar still opens, but only the
                DD/MM/YYYY label is shown (never the browser's US format). */}
            <div className="relative inline-flex items-center gap-2 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm cursor-pointer focus-within:ring-2 focus-within:ring-[#19C2D6]/40 focus-within:border-[#19C2D6]">
              <span className="tabular-nums">{fmtItalianDate(dateFrom)}</span>
              <svg className="w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>
              <input
                type="date"
                value={dateFrom}
                aria-label="Data inizio periodo"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onClick={(e) => (e.currentTarget as any).showPicker?.()}
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  setDateFrom(v)
                  // Keep range valid without locking the picker: if the new start
                  // is after the current end, push the end to match so the user
                  // can always re-select any date freely.
                  if (v > dateTo) setDateTo(v)
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <span className="text-theme-text-muted text-sm">→</span>
            <div className="relative inline-flex items-center gap-2 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm cursor-pointer focus-within:ring-2 focus-within:ring-[#19C2D6]/40 focus-within:border-[#19C2D6]">
              <span className="tabular-nums">{fmtItalianDate(dateTo)}</span>
              <svg className="w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>
              <input
                type="date"
                value={dateTo}
                aria-label="Data fine periodo"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onClick={(e) => (e.currentTarget as any).showPicker?.()}
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  setDateTo(v)
                  if (v < dateFrom) setDateFrom(v)
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
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
            <p className="text-sm font-semibold text-theme-text-primary tabular-nums">{periodLabel}</p>
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
        // 2026-08-27 (richiesta direzione): il Fatturato prende dal Noleggio la
        // stessa cifra della card "Ricavo TOTALE" del Report Terra, cioe'
        // incassato PIU' anticipato. Prima si fermava all'incassato e il
        // Dashboard restava sotto al Report senza spiegazione.
        const noleggioRicavo = mr ? (mr.noleggio.ricavoConAnticipato ?? mr.noleggio.ricavoTotale) : 0
        const fatturato = mr
          ? noleggioRicavo + mr.lavaggio.ricavoTotale + meccanica
          : d.revenue.currentMonth
        // Totale Complessivo del Noleggio = incassato + anticipato + da saldare.
        const noleggioDaSaldare = mr?.noleggio.daSaldare ?? 0
        const noleggioComplessivo = mr ? (mr.noleggio.totaleComplessivo ?? noleggioRicavo + noleggioDaSaldare) : 0
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

        // Scheda in stile Report Terra: etichetta piccola, numero grande, nota.
        const KpiCard = ({ title, value, trend, sub, trendDirection, tone }: {
          title: string
          value: string
          trend?: number | null
          sub?: string
          trendDirection?: 'up-good' | 'down-good'
          tone?: 'gold' | 'green' | 'red'
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
          const valueCls = tone === 'gold' ? 'text-dr7-gold' : tone === 'green' ? 'text-green-500' : tone === 'red' ? 'text-red-500' : 'text-theme-text-primary'
          const borderCls = tone === 'gold' ? 'border-dr7-gold/30' : 'border-theme-border'
          return (
            <div className={`bg-theme-bg-secondary/50 rounded-xl border ${borderCls} p-4`}>
              <p className="text-xs text-theme-text-muted">{title}</p>
              <p className={`text-2xl font-bold ${valueCls}`}>{value}</p>
              {(trendStr || sub) && (
                <p className="text-[10px] mt-0.5">
                  {trendStr && <span className={`font-semibold ${tColor}`}>{trendStr}</span>}
                  {trendStr && sub && ' · '}
                  {sub && <span className="text-theme-text-muted">{sub}</span>}
                </p>
              )}
            </div>
          )
        }

        return (
          <div>
            <SectionHeader title="Dashboard Proprietario / Investitore" subtitle="La situazione della tua azienda in uno sguardo" />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <KpiCard title="Fatturato" value={`\u20AC ${fmtDec(fatturato)}`} trend={d.revenue.changePercent} trendDirection="up-good" tone="gold" />
              {mr && (
                <KpiCard
                  title="Totale Complessivo Noleggio Terra"
                  value={`\u20AC ${fmtDec(noleggioComplessivo)}`}
                  sub={noleggioDaSaldare > 0 ? `di cui \u20AC ${fmtDec(noleggioDaSaldare)} da saldare \u00B7 = Report Terra` : '= Report Terra'}
                />
              )}
              <KpiCard title="Incassato Reale" value={`\u20AC ${fmtDec(incassato)}`} sub={`${incassatoPct}% del fatturato`} />
              <KpiCard title="Costi Totali" value={`\u20AC ${fmtDec(costiTotali)}`} sub={`${costiCount} fatture`} tone="red" />
              <KpiCard title="Margine Operativo" value={`\u20AC ${fmtDec(margine)}`} sub={`${marginePct}% del fatturato`} tone={margine >= 0 ? 'green' : 'red'} />
              <KpiCard title="Utile Netto Stimato" value={`\u20AC ${fmtDec(utileNetto)}`} trend={d.revenue.changePercent} trendDirection="up-good" sub="dopo tasse ~33%" />
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
        // 2026-08-24: Mare, Aria e Soggiorni entrano nelle Entrate. Prima il
        // Dashboard chiedeva a monthly-report solo il Noleggio Terra, quindi i
        // loro incassi non comparivano da nessuna parte.
        // 2026-08-27 (richiesta direzione): da ogni business si prende la stessa
        // cifra della card "Ricavo TOTALE" del Report (incassato + anticipato).
        // Il "da saldare" resta fuori dalle Entrate e si mostra a parte, come
        // fa il Report Terra con il Totale Complessivo.
        const ricavoDi = (b?: BusinessReport) => b ? (b.ricavoConAnticipato ?? b.ricavoTotale) : 0
        const noleggioRicavo = ricavoDi(mr.noleggio)
        const mare = ricavoDi(mr.mare)
        const aria = ricavoDi(mr.aria)
        const soggiorni = ricavoDi(mr.soggiorni)
        const daSaldareTot =
          (mr.noleggio.daSaldare ?? 0) +
          (mr.mare?.daSaldare ?? 0) +
          (mr.aria?.daSaldare ?? 0) +
          (mr.soggiorni?.daSaldare ?? 0)
        const businessScollegati = [
          mr.mare && !mr.mare.canonical ? 'Mare' : null,
          mr.aria && !mr.aria.canonical ? 'Aria' : null,
          mr.soggiorni && !mr.soggiorni.canonical ? 'Soggiorni' : null,
        ].filter(Boolean) as string[]
        const entrate =
          noleggioRicavo +
          mare + aria + soggiorni +
          mr.lavaggio.ricavoTotale +
          meccanica
        const uscitePagate = mr.fornitori.pagatoMese
        const cashNetto = entrate - uscitePagate
        const insolutiTot = mr.penaliDanni.insolutiTotale
        const danniTot = mr.penaliDanni.danniTotale
        return (
          <div>
            <SectionHeader title="Sintesi del Periodo" subtitle={`Tutte le attività del periodo in un colpo d'occhio · ${periodLabel}`} />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Entrate — 2026-08-27 (richiesta direzione): stessa forma del
                  Report Terra (tabella) e stesse cifre: dal Noleggio si prende
                  il Ricavo TOTALE (incassato + anticipato) e si mostra a parte
                  il Totale Complessivo con il da saldare. */}
              <ReportCard title="Entrate (totali attività)" right={`€ ${fmtDec(entrate)}`}>
                <ReportTable
                  head={
                    <>
                      <th className="text-left px-4 py-3">Attività</th>
                      <th className="text-right px-4 py-3">Ricavo</th>
                    </>
                  }
                  foot={
                    <ReportTotalRow>
                      <td className="px-4 py-2">Totale Entrate</td>
                      <td className="px-4 py-2 text-right tabular-nums text-dr7-gold">€ {fmtDec(entrate)}</td>
                    </ReportTotalRow>
                  }
                >
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Noleggio Terra</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">€ {fmtDec(noleggioRicavo)}</td>
                  </ReportRow>
                  {mr.noleggio.ricavoNoleggioPuro != null && (
                    <>
                      <ReportRow>
                        <td className="px-4 py-2 pl-8 text-theme-text-muted text-xs">di cui noleggio</td>
                        <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted text-xs">€ {fmtDec(mr.noleggio.ricavoNoleggioPuro)}</td>
                      </ReportRow>
                      <ReportRow>
                        <td className="px-4 py-2 pl-8 text-theme-text-muted text-xs">di cui penali</td>
                        <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted text-xs">€ {fmtDec(mr.noleggio.ricavoPenali ?? 0)}</td>
                      </ReportRow>
                      <ReportRow>
                        <td className="px-4 py-2 pl-8 text-theme-text-muted text-xs">di cui danni</td>
                        <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted text-xs">€ {fmtDec(mr.noleggio.ricavoDanni ?? 0)}</td>
                      </ReportRow>
                    </>
                  )}
                  {(mr.noleggio.ricavoAnticipato ?? 0) > 0 && (
                    <ReportRow>
                      <td className="px-4 py-2 pl-8 text-theme-text-muted text-xs">di cui anticipato</td>
                      <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted text-xs">€ {fmtDec(mr.noleggio.ricavoAnticipato ?? 0)}</td>
                    </ReportRow>
                  )}
                  {(mr.noleggio.daSaldare ?? 0) > 0 && (
                    <ReportRow>
                      <td className="px-4 py-2 pl-8 text-theme-text-muted text-xs">da saldare</td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-500 text-xs">€ {fmtDec(mr.noleggio.daSaldare ?? 0)}</td>
                    </ReportRow>
                  )}
                  {/* 2026-08-27 (richiesta direzione): la cifra da confrontare con la
                      card "Totale Complessivo" del Report Terra, al centesimo. Le
                      righe sotto sommano TUTTE le attivita' e sono un altro numero. */}
                  <ReportRow>
                    <td className="px-4 py-2 pl-8 font-semibold text-theme-text-primary text-xs">Totale Complessivo Noleggio Terra</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-theme-text-primary text-xs">
                      € {fmtDec(mr.noleggio.totaleComplessivo ?? (noleggioRicavo + (mr.noleggio.daSaldare ?? 0)))}
                    </td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Noleggio Mare</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">€ {fmtDec(mare)}</td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Noleggio Aria</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">€ {fmtDec(aria)}</td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Soggiorni</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">€ {fmtDec(soggiorni)}</td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Lavaggi</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">€ {fmtDec(mr.lavaggio.ricavoTotale)}</td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Meccanica</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">€ {fmtDec(meccanica)}</td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Incassato</td>
                    <td className="px-4 py-2 text-right tabular-nums text-green-500">€ {fmtDec(d.revenue.incassato)}</td>
                  </ReportRow>
                  {daSaldareTot > 0 && (
                    <ReportRow>
                      <td className="px-4 py-2 text-theme-text-primary">Da saldare (tutte le attività)</td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-500">€ {fmtDec(daSaldareTot)}</td>
                    </ReportRow>
                  )}
                  {daSaldareTot > 0 && (
                    <ReportRow>
                      <td className="px-4 py-2 font-semibold text-theme-text-primary">Totale Complessivo (tutte le attività)</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-theme-text-primary">€ {fmtDec(entrate + daSaldareTot)}</td>
                    </ReportRow>
                  )}
                </ReportTable>
                {businessScollegati.length > 0 && (
                  <p className="px-4 py-3 text-xs text-yellow-400 border-t border-theme-border">
                    {businessScollegati.join(', ')}: report non raggiungibile, quei ricavi non sono nel totale.
                  </p>
                )}
              </ReportCard>

              {/* Uscite */}
              <ReportCard title="Uscite" right={`€ ${fmtDec(uscitePagate)}`}>
                <ReportTable
                  head={
                    <>
                      <th className="text-left px-4 py-3">Voce</th>
                      <th className="text-right px-4 py-3">Importo</th>
                    </>
                  }
                  foot={
                    <ReportTotalRow>
                      <td className="px-4 py-2">Pagato nel periodo</td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-500">€ {fmtDec(uscitePagate)}</td>
                    </ReportTotalRow>
                  }
                >
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Pagato fornitori</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">€ {fmtDec(mr.fornitori.pagatoMese)}</td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Da pagare</td>
                    <td className="px-4 py-2 text-right tabular-nums text-yellow-400">€ {fmtDec(mr.fornitori.daPagare)}</td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Scaduto</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${mr.fornitori.scaduto > 0 ? 'text-red-500' : 'text-theme-text-primary'}`}>€ {fmtDec(mr.fornitori.scaduto)}</td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Alert aperti</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${mr.fornitori.alertsOpen > 0 ? 'text-yellow-400' : 'text-theme-text-primary'}`}>{mr.fornitori.alertsOpen}</td>
                  </ReportRow>
                </ReportTable>
              </ReportCard>

              {/* Cash netto */}
              <ReportCard title="Cash Netto" right="Entrate − Uscite">
                <ReportTable
                  head={
                    <>
                      <th className="text-left px-4 py-3">Voce</th>
                      <th className="text-right px-4 py-3">Importo</th>
                    </>
                  }
                  foot={
                    <ReportTotalRow>
                      <td className="px-4 py-2">Cash Netto</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${cashNetto >= 0 ? 'text-green-500' : 'text-red-500'}`}>€ {fmtDec(cashNetto)}</td>
                    </ReportTotalRow>
                  }
                >
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Entrate</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">€ {fmtDec(entrate)}</td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">Costi totali</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">€ {fmtDec(uscitePagate)}</td>
                  </ReportRow>
                  <ReportRow>
                    <td className="px-4 py-2 text-theme-text-primary">vs periodo precedente</td>
                    <td className="px-4 py-2 text-right"><Trend value={d.revenue.changePercent} size="sm" /></td>
                  </ReportRow>
                </ReportTable>
              </ReportCard>
            </div>

            {/* Second row — operations / customers / risks */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
              {/* Operatività */}
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
                <p className="text-[10px] uppercase tracking-widest text-blue-300 font-semibold mb-2">Operatività</p>
                <p className="text-3xl font-bold text-blue-400 leading-tight">{d.fleet.occupationRate}%</p>
                <p className="text-xs text-theme-text-muted mt-1">Occupazione flotta</p>
                <div className="mt-3 space-y-1 text-xs text-theme-text-muted">
                  <div className="flex justify-between"><span>Prenotazioni</span><span className="text-theme-text-primary">{mr.noleggio.prenotazioniCount}</span></div>
                  <div className="flex justify-between"><span>Annullate</span><span className={mr.noleggio.prenotazioniAnnullateCount > 0 ? 'text-amber-300' : 'text-theme-text-primary'}>{mr.noleggio.prenotazioniAnnullateCount} (€ {fmtDec(mr.noleggio.prenotazioniAnnullateValue)})</span></div>
                  <div className="flex justify-between"><span>Lavaggi</span><span className="text-theme-text-primary">{mr.lavaggio.count}</span></div>
                  <div className="flex justify-between pt-1 border-t border-theme-border mt-1">
                    <span>Conversion bookings</span><span className="text-theme-text-primary">{d.bookings.conversionRate}%</span>
                  </div>
                </div>
              </div>

              {/* Clienti & Preventivi */}
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
                <p className="text-[10px] uppercase tracking-widest text-purple-300 font-semibold mb-2">Clienti</p>
                <p className="text-3xl font-bold text-purple-400 leading-tight">+{mr.clienti.nuoviMese}</p>
                <p className="text-xs text-theme-text-muted mt-1">Nuovi clienti nel periodo</p>
                <div className="mt-3 space-y-1 text-xs text-theme-text-muted">
                  <div className="flex justify-between"><span>Attivi nel periodo</span><span className="text-theme-text-primary">{mr.clienti.attiviMese}</span></div>
                  <div className="flex justify-between"><span>Totale clienti</span><span className="text-theme-text-primary">{fmt(mr.clienti.totale)}</span></div>
                  <div className="flex justify-between"><span>Preventivi</span><span className="text-theme-text-primary">{mr.preventivi.total}</span></div>
                  <div className="flex justify-between pt-1 border-t border-theme-border mt-1">
                    <span>Conversion preventivi</span>
                    <span className={mr.preventivi.conversionRate >= 50 ? 'text-emerald-300' : 'text-amber-300'}>{mr.preventivi.conversionRate}%</span>
                  </div>
                </div>
              </div>

              {/* Rischi & Alert */}
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
                <p className="text-[10px] uppercase tracking-widest text-amber-300 font-semibold mb-2">Rischi & Alert</p>
                <p className={`text-3xl font-bold leading-tight ${(insolutiTot + danniTot + mr.fornitori.scaduto) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>€ {fmtDec(insolutiTot + danniTot + mr.fornitori.scaduto)}</p>
                <p className="text-xs text-theme-text-muted mt-1">Insoluti + Danni + Scaduto fornitori</p>
                <div className="mt-3 space-y-1 text-xs text-theme-text-muted">
                  <div className="flex justify-between"><span>Insoluti</span><span className={insolutiTot > 0 ? 'text-amber-300' : 'text-theme-text-primary'}>€ {fmtDec(insolutiTot)} ({mr.penaliDanni.insolutiCount})</span></div>
                  <div className="flex justify-between"><span>Danni</span><span className={danniTot > 0 ? 'text-red-300' : 'text-theme-text-primary'}>€ {fmtDec(danniTot)} ({mr.penaliDanni.danniCount})</span></div>
                  <div className="flex justify-between"><span>Scaduto fornitori</span><span className={mr.fornitori.scaduto > 0 ? 'text-red-300' : 'text-theme-text-primary'}>€ {fmtDec(mr.fornitori.scaduto)}</span></div>
                  <div className="flex justify-between pt-1 border-t border-theme-border mt-1">
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
        const monthLabel = periodLabel
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
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
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
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
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
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 mt-3">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Occupazione — 2026-08-27: numeri e tabella, niente lancetta ne' barre. */}
          <ReportCard title="Occupazione" right={`${d.fleet.occupationRate}%`}>
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Stato</th>
                  <th className="text-right px-4 py-3">Veicoli</th>
                </>
              }
              foot={
                <ReportTotalRow>
                  <td className="px-4 py-2">Totale flotta</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.fleet.rentedNow + d.fleet.idleNow}</td>
                </ReportTotalRow>
              }
            >
              <ReportRow>
                <td className="px-4 py-2 text-theme-text-primary">Noleggiati</td>
                <td className="px-4 py-2 text-right tabular-nums text-green-500">{d.fleet.rentedNow}</td>
              </ReportRow>
              <ReportRow>
                <td className="px-4 py-2 text-theme-text-primary">Fermi</td>
                <td className="px-4 py-2 text-right tabular-nums text-yellow-400">{d.fleet.idleNow}</td>
              </ReportRow>
            </ReportTable>
          </ReportCard>

          {/* Confronto */}
          <ReportCard title="Confronto Periodo Precedente">
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Periodo</th>
                  <th className="text-right px-4 py-3">Occupazione</th>
                </>
              }
              foot={
                <ReportTotalRow>
                  <td className="px-4 py-2">Variazione</td>
                  <td className="px-4 py-2 text-right"><Trend value={d.fleet.changePercent} suffix="%" /></td>
                </ReportTotalRow>
              }
            >
              <ReportRow>
                <td className="px-4 py-2 text-theme-text-primary">Periodo corrente</td>
                <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{d.fleet.occupationRate}%</td>
              </ReportRow>
              <ReportRow>
                <td className="px-4 py-2 text-theme-text-primary">Periodo precedente</td>
                <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{d.fleet.previousRate}%</td>
              </ReportRow>
            </ReportTable>
          </ReportCard>

          {/* Veicoli fermi da tempo */}
          <ReportCard
            title="Attenzione"
            right={d.fleet.vehiclesIdleLong.length > 0 ? `${d.fleet.vehiclesIdleLong.length} fermi da oltre 10 giorni` : 'tutti attivi'}
          >
            {d.fleet.vehiclesIdleLong.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-theme-text-muted">Tutti i veicoli attivi</div>
            ) : (
              <div className="max-h-56 overflow-y-auto">
                <ReportTable
                  head={
                    <>
                      <th className="text-left px-4 py-3">Veicolo</th>
                      <th className="text-left px-4 py-3">Targa</th>
                      <th className="text-right px-4 py-3">Fermo da</th>
                    </>
                  }
                >
                  {d.fleet.vehiclesIdleLong.map((v, i) => (
                    <ReportRow key={i}>
                      <td className="px-4 py-2 text-theme-text-primary">{v.name}</td>
                      <td className="px-4 py-2 text-theme-text-muted">{v.plate}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-500">{v.idleDays}g</td>
                    </ReportRow>
                  ))}
                </ReportTable>
              </div>
            )}
          </ReportCard>
        </div>
      </div>

      {/* ========== RICAVO MEDIO + PRENOTAZIONI (side by side) ========== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* RICAVO MEDIO PER VEICOLO */}
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <p className="text-[10px] uppercase tracking-widest text-theme-text-muted font-semibold mb-3">Ricavo Medio per Veicolo</p>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-bold text-dr7-gold">{'\u20AC'} {fmtDec(d.revenuePerVehicle.avgPerDay)}</span>
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
                  <div key={i} className="flex items-center justify-between bg-theme-bg-tertiary/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-muted'}`}>
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
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <p className="text-[10px] uppercase tracking-widest text-theme-text-muted font-semibold mb-3">Prenotazioni</p>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-bold text-dr7-gold">{d.bookings.total}</span>
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

          <div className="bg-theme-bg-tertiary/30 rounded-xl border border-theme-border px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-theme-text-muted">Tasso di conversione</p>
            <p className="text-lg font-bold text-theme-text-primary tabular-nums">
              {d.bookings.conversionRate}% <span className="text-xs font-normal text-theme-text-muted">({conversionLabel})</span>
            </p>
          </div>
        </div>
      </div>

      {/* ========== CLIENTI ========== */}
      <div>
        <SectionHeader title="Clienti" subtitle="La salute del tuo business" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard label="Nuovi Clienti" value={String(d.customers.newThisMonth)} trend={d.customers.changePercent} accent="gold" />
          <StatCard label="Clienti Attivi" value={fmt(d.customers.activeThisMonth)} accent="default" />
          <StatCard label="Totale Clienti" value={fmt(d.customers.totalCustomers)} accent="default" />
        </div>
      </div>

      {/* ========== DANNI / RISCHI / INSOLUTI ========== */}
      <div>
        <SectionHeader title="Danni / Rischi / Insoluti" subtitle="Dove stai perdendo soldi?" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
          <StatCard
            label="Danni Questo Mese"
            value={`\u20AC ${fmtDec(d.damages.danniAmount)}`}
            sub={`${d.damages.danniCount} sinistri aperti`}
            trend={d.damages.changePercent}
            trendInvert
            accent="red"
          />
          <StatCard
            label="Insoluti"
            value={`\u20AC ${fmtDec(d.damages.insoluti)}`}
            sub={`${d.damages.insolutiCount} pagamenti in ritardo`}
            accent="orange"
          />
          {d.damages.previousDanniAmount > 0 && (
            <StatCard label="Danni Mese Precedente" value={`\u20AC ${fmtDec(d.damages.previousDanniAmount)}`} accent="default" />
          )}
        </div>
        {d.damages.insoluti > 0 && (
          <AlertBox type="danger">
            {'\u20AC'} {fmtDec(d.damages.insoluti)} di insoluti da recuperare ({d.damages.insolutiCount} voci in attesa di pagamento)
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
              className="text-left bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 hover:bg-theme-bg-tertiary/30C2D6]/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-widest text-theme-text-muted font-semibold">Noleggio</p>
                <span className="text-theme-text-muted text-xs group-hover:text-dr7-gold">Apri →</span>
              </div>
              <p className="text-2xl font-bold text-dr7-gold">€ {fmtDec(d.monthlyReports.noleggio.ricavoTotale)}</p>
              <p className="text-xs text-theme-text-muted mt-1">{d.monthlyReports.noleggio.prenotazioniCount} prenotazioni · {d.monthlyReports.noleggio.prenotazioniAnnullateCount} annullate (€ {fmtDec(d.monthlyReports.noleggio.prenotazioniAnnullateValue)})</p>
            </button>

            {/* LAVAGGIO */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: d.monthlyReports!.lavaggio.link } }))}
              className="text-left bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 hover:bg-theme-bg-tertiary/30 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-widest text-theme-text-muted font-semibold">Lavaggio</p>
                <span className="text-theme-text-muted text-xs group-hover:text-blue-400">Apri →</span>
              </div>
              <p className="text-2xl font-bold text-blue-400">€ {fmtDec(d.monthlyReports.lavaggio.ricavoTotale)}</p>
              <p className="text-xs text-theme-text-muted mt-1">{d.monthlyReports.lavaggio.count} lavaggi nel periodo</p>
            </button>

            {/* CLIENTI */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: d.monthlyReports!.clienti.link } }))}
              className="text-left bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 hover:bg-theme-bg-tertiary/30 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-widest text-theme-text-muted font-semibold">Clienti</p>
                <span className="text-theme-text-muted text-xs group-hover:text-emerald-400">Apri →</span>
              </div>
              <p className="text-2xl font-bold text-emerald-400">+{d.monthlyReports.clienti.nuoviMese}</p>
              <p className="text-xs text-theme-text-muted mt-1">{d.monthlyReports.clienti.attiviMese} attivi nel periodo · {fmt(d.monthlyReports.clienti.totale)} totali</p>
            </button>

            {/* PENALI & DANNI */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: d.monthlyReports!.penaliDanni.link } }))}
              className="text-left bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 hover:bg-theme-bg-tertiary/30 transition-colors group"
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
              className="text-left bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 hover:bg-theme-bg-tertiary/30 transition-colors group"
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
              className="text-left bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 hover:bg-theme-bg-tertiary/30 transition-colors group"
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
        <SectionHeader title="Fatturato del Periodo" subtitle="Tutte le prenotazioni del periodo — pagate, da incassare e scadute" />
        {/* Totale fatturato \u2014 TUTTO il mese, indipendentemente dallo stato pagamento */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <StatCard
            label="Totale Fatturato Periodo"
            value={`\u20AC ${fmtDec(d.revenue.currentMonth)}`}
            sub={`Incassato + da incassare (tutte le prenotazioni valide di ${periodLabel})`}
            accent="gold"
          />
          <StatCard
            label="Periodo precedente"
            value={`\u20AC ${fmtDec(d.revenue.previousMonth)}`}
            trend={d.revenue.changePercent}
            accent="default"
          />
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <StatCard label="Incassato" value={`\u20AC ${fmtDec(d.cashFlow.incassato)}`} sub="Cassa effettiva" accent="green" />
          <StatCard label="Da Incassare" value={`\u20AC ${fmtDec(d.cashFlow.daIncassare)}`} sub="Pending / da saldare" accent="orange" />
          <StatCard label="Scaduti" value={`\u20AC ${fmtDec(d.cashFlow.insolutiScaduti)}`} sub="Non pagati oltre scadenza" accent="red" />
        </div>

        {/* Visibility on what's intentionally NOT in fatturato */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatCard
            label="Annullate del periodo"
            value={`\u20AC ${fmtDec(d.revenue.cancelledRentalsTotal || 0)}`}
            sub={`${d.revenue.cancelledRentalsCount || 0} prenotazioni cancellate (non in fatturato)`}
            accent="red"
          />
          <StatCard
            label="Lavaggi del periodo"
            value={`\u20AC ${fmtDec(d.revenue.washTotal || 0)}`}
            sub={`${d.revenue.washCount || 0} lavaggi (rendiconto separato)`}
            accent="blue"
          />
        </div>
        {/* Distribuzione — 2026-08-27: tabella come sul Report Terra,
            niente barra impilata. */}
        {cashTotal > 0 && (
          <ReportCard title="Distribuzione" right={`Totale: € ${fmtDec(cashTotal)}`}>
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Voce</th>
                  <th className="text-right px-4 py-3">Importo</th>
                  <th className="text-right px-4 py-3">%</th>
                </>
              }
              foot={
                <ReportTotalRow>
                  <td className="px-4 py-2">Totale</td>
                  <td className="px-4 py-2 text-right tabular-nums text-dr7-gold">€ {fmtDec(cashTotal)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">100%</td>
                </ReportTotalRow>
              }
            >
              <ReportRow>
                <td className="px-4 py-2 text-theme-text-primary">Incassato</td>
                <td className="px-4 py-2 text-right tabular-nums text-green-500">€ {fmtDec(d.cashFlow.incassato)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted">{Math.round((d.cashFlow.incassato / cashTotal) * 100)}%</td>
              </ReportRow>
              <ReportRow>
                <td className="px-4 py-2 text-theme-text-primary">Da incassare</td>
                <td className="px-4 py-2 text-right tabular-nums text-yellow-400">€ {fmtDec(d.cashFlow.daIncassare)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted">{Math.round((d.cashFlow.daIncassare / cashTotal) * 100)}%</td>
              </ReportRow>
              <ReportRow>
                <td className="px-4 py-2 text-theme-text-primary">Scaduti</td>
                <td className="px-4 py-2 text-right tabular-nums text-red-500">€ {fmtDec(d.cashFlow.insolutiScaduti)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted">{Math.round((d.cashFlow.insolutiScaduti / cashTotal) * 100)}%</td>
              </ReportRow>
            </ReportTable>
          </ReportCard>
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
              <div className="bg-theme-bg-secondary/60 rounded-xl p-4 border border-theme-border">
                <p className="text-xs text-theme-text-muted uppercase tracking-wide">Pagato nel periodo</p>
                <p className="text-xl font-semibold text-theme-text-primary mt-1">€ {fmtDec(fcf.pagatoMese)}</p>
                <p className="text-xs text-theme-text-muted mt-1">
                  {fcf.invoicePaidCount} fatture · {trend >= 0 ? '+' : ''}{trend}% vs mese prec.
                </p>
              </div>
              <div className="bg-theme-bg-secondary/60 rounded-xl p-4 border border-theme-border">
                <p className="text-xs text-theme-text-muted uppercase tracking-wide">Da Pagare</p>
                <p className="text-xl font-semibold text-amber-400 mt-1">€ {fmtDec(fcf.daPagare)}</p>
                <p className="text-xs text-theme-text-muted mt-1">{fcf.daPagareCount} fatture aperte</p>
              </div>
              <div className="bg-theme-bg-secondary/60 rounded-xl p-4 border border-theme-border">
                <p className="text-xs text-theme-text-muted uppercase tracking-wide">Scaduto</p>
                <p className={`text-xl font-semibold mt-1 ${fcf.scaduto > 0 ? 'text-red-400' : 'text-theme-text-primary'}`}>€ {fmtDec(fcf.scaduto)}</p>
                <p className="text-xs text-theme-text-muted mt-1">{fcf.scadutoCount} fatture scadute</p>
              </div>
              <div className="bg-theme-bg-secondary/60 rounded-xl p-4 border border-theme-border">
                <p className="text-xs text-theme-text-muted uppercase tracking-wide">Margine Netto Cash</p>
                <p className="text-xl font-semibold text-emerald-400 mt-1">€ {fmtDec(margineNetto)}</p>
                <p className="text-xs text-theme-text-muted mt-1">Fatturato − Pagato</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAlertDetails(v => !v)}
                className="bg-theme-bg-secondary/60 rounded-xl p-4 border border-theme-border text-left hover:border-amber-500/30 transition-colors"
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
              <div className="mt-3 bg-amber-500/5 border border-amber-500/30 rounded-xl p-4">
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
                  <ScheletroTesto righe={2} />
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
                  <div className="bg-theme-bg-secondary/60 rounded-xl p-4 border border-theme-border">
                    <p className="text-xs text-theme-text-muted uppercase tracking-wide mb-2">Top Fornitori (pagato nel periodo)</p>
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
                  <div className="bg-theme-bg-secondary/60 rounded-xl p-4 border border-theme-border">
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
          <ScheletroTabella righe={5} colonne={5} />
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
              />
              <StatCard
                label="Fornitori Attivi"
                value={String(Object.keys(supplierData.supplierTotals).length)}
                sub={`su 9 monitorati`}
                accent="default"
              />
              {d && (
                <StatCard
                  label="Margine Operativo"
                  value={`\u20AC ${fmtDec(d.revenue.currentMonth - supplierData.grandTotal)}`}
                  sub={`Fatturato \u20AC ${fmtDec(d.revenue.currentMonth)} - Costi \u20AC ${fmtDec(supplierData.grandTotal)}`}
                  accent={d.revenue.currentMonth - supplierData.grandTotal > 0 ? 'green' : 'red'}
                />
              )}
            </div>

            {/* Supplier breakdown table */}
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
              <button
                onClick={() => setSupplierExpanded(!supplierExpanded)}
                className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-theme-bg-tertiary/30 transition-colors"
              >
                <span className="text-sm font-semibold text-theme-text-primary uppercase tracking-wide">Dettaglio per Fornitore</span>
                <svg className={`w-4 h-4 text-theme-text-muted transition-transform ${supplierExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {supplierExpanded && (
                <div className="border-t border-theme-border">
                  {Object.entries(supplierData.supplierTotals)
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([supplier, info]) => (
                      <div key={supplier} className="border-b border-theme-border last:border-b-0">
                        <button
                          onClick={() => setSupplierDetailOpen(supplierDetailOpen === supplier ? null : supplier)}
                          className="w-full px-5 py-3 flex items-center justify-between hover:bg-theme-bg-tertiary/30 transition-colors"
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
                                <div key={inv.id || idx} className="flex items-center justify-between bg-theme-bg-tertiary/30 rounded-lg px-3 py-2">
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
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
            <p className="text-red-400 font-medium text-sm mb-1">Errore caricamento fatture fornitori</p>
            <p className="text-theme-text-muted text-xs">{supplierError}</p>
            <button onClick={() => fetchSupplierCosts(dateFrom, dateTo)} className="mt-3 px-4 py-1.5 bg-[#19C2D6] text-black rounded-lg text-xs font-bold hover:bg-[#0A8FA3] transition-colors">
              Riprova
            </button>
          </div>
        )}
      </div>

      {/* ========== STATO DI SALUTE ========== */}
      <div className="bg-theme-bg-secondary/50 rounded-xl p-6 border border-theme-border">
        <div className="flex flex-col sm:flex-row items-start gap-6">
          <div className="shrink-0">
            <p className="text-xs text-theme-text-muted">Stato di salute</p>
            <p className="text-3xl font-bold tabular-nums" style={{ color: health.color }}>{health.score}%</p>
            <p className="text-[10px] uppercase tracking-wider text-theme-text-muted mt-0.5">{health.label}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-theme-text-primary mb-1">Stato di Salute Azienda</h3>
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
