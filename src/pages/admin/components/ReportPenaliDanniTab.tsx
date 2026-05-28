import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import DateRangePicker, { resolveDateRange, isInRange, type DateRangeValue } from '../../../components/admin/DateRangePicker'

// ─── Types matching netlify/functions/report-danni.ts response ────────────────
interface Entry {
  id: string
  date: string | null
  type: 'danni' | 'penali'
  category: string
  customerName: string
  vehicleName: string
  vehiclePlate: string
  description: string
  amount: number
  status: 'paid' | 'pending' | 'cancelled' | 'blocked'
  serviceType: 'noleggio' | 'lavaggio' | 'meccanica' | 'altro'
  source: 'fattura' | 'pending' | 'cauzione'
}

interface ReportData {
  type: string
  totalVehicles: number
  totalCount: number
  totalAmount: number
  vehicles: Array<{
    vehicleName: string
    vehiclePlate: string
    customerName: string
    count: number
    totalAmount: number
  }>
  entries?: Entry[]
}

type TableFilter = 'all' | 'danni' | 'penali'

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmtEur = (n: number): string =>
  `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const fmtEur2 = (n: number): string =>
  `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (s: string | null): string => {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
const initials = (name: string): string => {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || '?'
}

const AVATAR_COLORS = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-orange-100 text-orange-700',
]
const avatarColor = (seed: string): string => {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// Tipo & stato chips
const TYPE_STYLES = {
  danni: 'bg-rose-50 text-rose-700 border-rose-200',
  penali: 'bg-orange-50 text-orange-700 border-orange-200',
}
const STATUS_STYLES: Record<Entry['status'], { label: string; cls: string }> = {
  paid: { label: 'Pagata', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  pending: { label: 'In sospeso', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  blocked: { label: 'Cauzione', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  cancelled: { label: 'Annullata', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
}

const COLORS = {
  rose: '#e11d48',
  orange: '#f97316',
  amber: '#f59e0b',
  gold: '#c5a046',
  emerald: '#10b981',
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  zinc: '#71717a',
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ReportPenaliDanniTab() {
  const [penaliData, setPenaliData] = useState<ReportData | null>(null)
  const [danniData, setDanniData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Filters
  const [dateRange, setDateRange] = useState<DateRangeValue>({ preset: '30' })
  const [tableFilter, setTableFilter] = useState<TableFilter>('all')

  // Pagination for detail table
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 8

  useEffect(() => { fetchReports() }, [])
  useEffect(() => { setPage(1) }, [tableFilter, dateRange])

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

  // ── Cutoff & filtered entries ─────────────────────────────────────────────
  const range = useMemo(() => resolveDateRange(dateRange), [dateRange])

  const allEntries: Entry[] = useMemo(() => {
    const e: Entry[] = []
    if (penaliData?.entries) e.push(...penaliData.entries)
    if (danniData?.entries) e.push(...danniData.entries)
    return e
  }, [penaliData, danniData])

  const filteredEntries: Entry[] = useMemo(() => {
    return allEntries.filter(e => isInRange(e.date, range))
  }, [allEntries, range])

  // ── KPIs (7 cards) ────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const sum = (filter: (e: Entry) => boolean): number =>
      filteredEntries.filter(filter).reduce((s, e) => s + e.amount, 0)
    const dannitTot = sum(e => e.type === 'danni')
    const penaliTot = sum(e => e.type === 'penali')
    return {
      danniTot: dannitTot,
      penaliTot,
      contenziosoTot: dannitTot + penaliTot,
      danniNoleggio: sum(e => e.type === 'danni' && e.serviceType === 'noleggio'),
      penaliNoleggio: sum(e => e.type === 'penali' && e.serviceType === 'noleggio'),
      danniLavaggio: sum(e => e.type === 'danni' && (e.serviceType === 'lavaggio' || e.serviceType === 'meccanica')),
      penaliLavaggio: sum(e => e.type === 'penali' && (e.serviceType === 'lavaggio' || e.serviceType === 'meccanica')),
    }
  }, [filteredEntries])

  // ── Andamento (time series, monthly) ─────────────────────────────────────
  const trendData = useMemo(() => {
    const buckets = new Map<string, { month: string; danni: number; penali: number; totale: number }>()
    for (const e of filteredEntries) {
      if (!e.date) continue
      const d = new Date(e.date)
      if (isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' })
      const b = buckets.get(key) || { month: label, danni: 0, penali: 0, totale: 0 }
      if (e.type === 'danni') b.danni += e.amount
      else b.penali += e.amount
      b.totale += e.amount
      buckets.set(key, b)
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)
  }, [filteredEntries])

  // ── Donut: danni vs penali ───────────────────────────────────────────────
  const ripartizioneData = useMemo(() => [
    { name: 'Danni', value: kpi.danniTot, fill: COLORS.rose },
    { name: 'Penali', value: kpi.penaliTot, fill: COLORS.orange },
  ], [kpi])

  // ── Per tipologia (horizontal bars, top 7 categories) ────────────────────
  const tipologiaData = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of filteredEntries) {
      map.set(e.category, (map.get(e.category) || 0) + e.amount)
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7)
  }, [filteredEntries])

  // ── Stato pratiche donut ─────────────────────────────────────────────────
  const statoData = useMemo(() => {
    const map = new Map<Entry['status'], number>()
    for (const e of filteredEntries) {
      map.set(e.status, (map.get(e.status) || 0) + 1)
    }
    const colorFor: Record<Entry['status'], string> = {
      paid: COLORS.emerald, pending: COLORS.amber, blocked: COLORS.rose, cancelled: COLORS.zinc,
    }
    return Array.from(map.entries()).map(([k, v]) => ({
      name: STATUS_STYLES[k].label, value: v, fill: colorFor[k],
    }))
  }, [filteredEntries])

  // ── Top clienti (by total amount) ────────────────────────────────────────
  const topClienti = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>()
    for (const e of filteredEntries) {
      if (!e.customerName || e.customerName === '-') continue
      const cur = map.get(e.customerName) || { name: e.customerName, total: 0, count: 0 }
      cur.total += e.amount; cur.count += 1
      map.set(e.customerName, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 6)
  }, [filteredEntries])

  // ── Allerte critiche (pending > €500 OR > 30 days old) ───────────────────
  const allerte = useMemo(() => {
    const now = new Date()
    return filteredEntries
      .filter(e => e.status === 'pending')
      .map(e => {
        const d = e.date ? new Date(e.date) : null
        const daysOld = d ? Math.floor((now.getTime() - d.getTime()) / 86400000) : 0
        let severity: 'high' | 'medium' | 'low' = 'low'
        if (e.amount >= 1000 || daysOld > 60) severity = 'high'
        else if (e.amount >= 300 || daysOld > 30) severity = 'medium'
        return { ...e, daysOld, severity }
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
  }, [filteredEntries])

  // ── Detail table data ────────────────────────────────────────────────────
  const detailEntries = useMemo(() => {
    return filteredEntries
      .filter(e => tableFilter === 'all' || e.type === tableFilter)
      .sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0
        const db = b.date ? new Date(b.date).getTime() : 0
        return db - da
      })
  }, [filteredEntries, tableFilter])

  const totalPages = Math.max(1, Math.ceil(detailEntries.length / PAGE_SIZE))
  const pageItems = detailEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── Per veicolo Top 10 ───────────────────────────────────────────────────
  const perVeicolo = useMemo(() => {
    const map = new Map<string, { name: string; value: number }>()
    for (const e of filteredEntries) {
      const key = e.vehiclePlate || e.vehicleName
      const cur = map.get(key) || { name: e.vehicleName || e.vehiclePlate, value: 0 }
      cur.value += e.amount
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [filteredEntries])

  // ── Confronto periodo (current cutoff vs previous of same length) ────────
  const confronto = useMemo(() => {
    if (!cutoff) return null
    const periodMs = Date.now() - cutoff.getTime()
    const prevCutoff = new Date(cutoff.getTime() - periodMs)
    const inRange = (e: Entry, start: Date, end: Date) => {
      if (!e.date) return false
      const d = new Date(e.date)
      return d >= start && d < end
    }
    const sum = (filter: (e: Entry) => boolean) =>
      allEntries.filter(filter).reduce((s, e) => s + e.amount, 0)
    const curDanni = sum(e => e.type === 'danni' && inRange(e, cutoff, new Date()))
    const curPenali = sum(e => e.type === 'penali' && inRange(e, cutoff, new Date()))
    const prevDanni = sum(e => e.type === 'danni' && inRange(e, prevCutoff, cutoff))
    const prevPenali = sum(e => e.type === 'penali' && inRange(e, prevCutoff, cutoff))
    const pct = (cur: number, prev: number) => prev === 0 ? null : ((cur - prev) / prev) * 100
    return {
      danni: { current: curDanni, previous: prevDanni, pct: pct(curDanni, prevDanni) },
      penali: { current: curPenali, previous: prevPenali, pct: pct(curPenali, prevPenali) },
      totale: { current: curDanni + curPenali, previous: prevDanni + prevPenali, pct: pct(curDanni + curPenali, prevDanni + prevPenali) },
    }
  }, [cutoff, allEntries])

  // ── Previsioni (linear projection from last 30 days → next 30) ──────────
  const previsioni = useMemo(() => {
    const last30 = new Date()
    last30.setDate(last30.getDate() - 30)
    const recent = allEntries.filter(e => {
      if (!e.date) return false
      const d = new Date(e.date)
      return d >= last30
    })
    const recentTotal = recent.reduce((s, e) => s + e.amount, 0)
    const danniProj = recent.filter(e => e.type === 'danni').reduce((s, e) => s + e.amount, 0)
    const penaliProj = recent.filter(e => e.type === 'penali').reduce((s, e) => s + e.amount, 0)
    return {
      danni: danniProj,
      penali: penaliProj,
      totale: recentTotal,
      importoMedio: recent.length > 0 ? recentTotal / recent.length : 0,
    }
  }, [allEntries])

  // ── Principali cause donut ───────────────────────────────────────────────
  const causeData = useMemo(() => {
    const palette = [COLORS.rose, COLORS.orange, COLORS.amber, COLORS.violet, COLORS.sky, COLORS.emerald, COLORS.zinc]
    return tipologiaData.slice(0, 6).map((t, i) => ({ ...t, fill: palette[i % palette.length] }))
  }, [tipologiaData])

  // ── CSV / Excel / PDF exports ───────────────────────────────────────────
  const exportCsv = () => {
    const headers = ['Data', 'Tipo', 'Categoria', 'Cliente', 'Veicolo', 'Targa', 'Descrizione', 'Importo', 'Stato', 'Servizio']
    const rows = detailEntries.map(e => [
      fmtDate(e.date),
      e.type === 'danni' ? 'Danno' : 'Penale',
      e.category,
      e.customerName,
      e.vehicleName,
      e.vehiclePlate,
      e.description.replace(/[\r\n,;]/g, ' '),
      e.amount.toFixed(2),
      STATUS_STYLES[e.status].label,
      e.serviceType,
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-danni-penali-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary tracking-tight">Report Danni & Penali</h2>
          <p className="text-sm text-theme-text-secondary mt-0.5">Analisi completa e performance di danni e penali</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <button
            onClick={fetchReports}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-theme-text-primary text-sm font-semibold rounded-full border border-theme-border hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? 'Aggiorno…' : 'Aggiorna'}
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 px-4 py-2 bg-dr7-gold text-white text-sm font-semibold rounded-full hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2a4 4 0 014-4h6m0 0l-3-3m3 3l-3 3M5 5h4l2 3h6a2 2 0 012 2v0" />
            </svg>
            Genera Report
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {/* ── KPI cards (7) ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <KpiCard label="Danni Totali" value={fmtEur(kpi.danniTot)} accent="rose" sub="contestati e in liquidazione" />
        <KpiCard label="Penali Totali" value={fmtEur(kpi.penaliTot)} accent="orange" sub="aperte ed evase" />
        <KpiCard label="Totale Contenzioso" value={fmtEur(kpi.contenziosoTot)} accent="gold" sub="combinato" big />
        <KpiCard label="Danni Noleggio" value={fmtEur(kpi.danniNoleggio)} accent="rose" sub="parco veicoli" />
        <KpiCard label="Penali Noleggio" value={fmtEur(kpi.penaliNoleggio)} accent="orange" sub="violazioni contrattuali" />
        <KpiCard label="Danni Lavaggio" value={fmtEur(kpi.danniLavaggio)} accent="rose" sub="Prime Wash + meccanica" />
        <KpiCard label="Penali Lavaggio" value={fmtEur(kpi.penaliLavaggio)} accent="orange" sub="Prime Wash + meccanica" />
      </div>

      {/* ── Row 2: charts + Azioni Rapide sidebar ────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Andamento (col-span 2) */}
        <Card title="Andamento Danni e Penali" subtitle="Trend per periodo selezionato" className="xl:col-span-2 min-h-[300px]">
          {trendData.length === 0 ? (
            <EmptyChart message="Nessun dato per il periodo" />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="gDanni" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.rose} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={COLORS.rose} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gPenali" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => fmtEur2(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="danni" name="Danni" stroke={COLORS.rose} fill="url(#gDanni)" strokeWidth={2} />
                <Area type="monotone" dataKey="penali" name="Penali" stroke={COLORS.orange} fill="url(#gPenali)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Ripartizione donut */}
        <Card title="Ripartizione Danni vs Penali" subtitle="Volumi correnti" className="min-h-[300px]">
          {kpi.contenziosoTot === 0 ? (
            <EmptyChart message="Nessun dato" />
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={ripartizioneData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" stroke="none">
                    {ripartizioneData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtEur(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-[11px] uppercase tracking-wide text-theme-text-muted">Totale</div>
                <div className="text-lg font-bold text-theme-text-primary">{fmtEur(kpi.contenziosoTot)}</div>
              </div>
              <div className="flex justify-center gap-4 mt-2 text-xs">
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: COLORS.rose }} /> Danni {fmtEur(kpi.danniTot)}</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: COLORS.orange }} /> Penali {fmtEur(kpi.penaliTot)}</span>
              </div>
            </div>
          )}
        </Card>

        {/* Azioni Rapide */}
        <Card title="Azioni Rapide" className="min-h-[300px]">
          <div className="space-y-1.5">
            {[
              { icon: '⊕', label: 'Nuova Segnalazione', tab: 'gestione-danni' },
              { icon: '€', label: 'Crea Penale Manuale', tab: 'gestione-multe' },
              { icon: '⚑', label: 'Verifica Pratiche Aperte', tab: 'unpaid' },
              { icon: '↧', label: 'Esporta Excel', action: exportCsv },
              { icon: '↥', label: 'Importa CSV', tab: 'bulk-import' },
              { icon: '⚙', label: 'Analisi Predittiva', tab: 'reports' },
              { icon: '↻', label: 'Riconciliazione Sospesi', tab: 'fattura' },
            ].map(a => (
              <button
                key={a.label}
                onClick={() => {
                  if (a.action) return a.action()
                  if (a.tab) window.dispatchEvent(new CustomEvent('admin:switch-tab', { detail: { tab: a.tab } }))
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-theme-text-primary hover:bg-theme-bg-hover rounded-lg transition-colors"
              >
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-dr7-gold/10 text-dr7-gold text-xs font-semibold">{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Row 3: per tipologia + stato pratiche ────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Danni e Penali per Tipologia" subtitle="Distribuzione importi per causa" className="xl:col-span-2">
          {tipologiaData.length === 0 ? (
            <EmptyChart message="Nessun dato" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, tipologiaData.length * 32)}>
              <BarChart data={tipologiaData} layout="vertical" margin={{ left: 10, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} width={150} />
                <Tooltip formatter={(v) => fmtEur2(Number(v))} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} fill={COLORS.gold} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Stato Pratiche" subtitle="Aperte / risolte / annullate">
          {statoData.length === 0 ? (
            <EmptyChart message="Nessun dato" />
          ) : (
            <div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={statoData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" stroke="none">
                    {statoData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {statoData.map(s => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: s.fill }} />
                      {s.name}
                    </span>
                    <span className="font-semibold text-theme-text-primary">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title="Allerte Critiche" subtitle={`${allerte.length} pratiche da gestire`}>
          {allerte.length === 0 ? (
            <div className="text-xs text-theme-text-muted py-6 text-center">Nessuna allerta attiva</div>
          ) : (
            <div className="space-y-2">
              {allerte.map(a => (
                <div key={a.id} className={`p-2.5 rounded-lg border-l-4 ${
                  a.severity === 'high' ? 'bg-rose-50 border-rose-500'
                  : a.severity === 'medium' ? 'bg-amber-50 border-amber-500'
                  : 'bg-sky-50 border-sky-500'
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-theme-text-primary truncate">{a.customerName || 'Cliente sconosciuto'}</div>
                      <div className="text-[11px] text-theme-text-secondary truncate">{a.category} · {a.vehiclePlate}</div>
                      <div className="text-[11px] text-theme-text-muted">{a.daysOld}g in sospeso</div>
                    </div>
                    <span className="text-sm font-bold text-theme-text-primary whitespace-nowrap">{fmtEur(a.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Row 4: Top clienti + Dettaglio table ─────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Detail table (col-span 3) */}
        <Card
          title="Dettaglio Danni & Penali"
          subtitle={`${detailEntries.length} ${detailEntries.length === 1 ? 'pratica' : 'pratiche'}`}
          className="xl:col-span-3"
          headerRight={
            <div className="inline-flex rounded-full bg-theme-bg-tertiary/40 p-1 border border-theme-border">
              {([
                { k: 'all' as TableFilter, l: 'Tutti', n: filteredEntries.length },
                { k: 'danni' as TableFilter, l: 'Danni', n: filteredEntries.filter(e => e.type === 'danni').length },
                { k: 'penali' as TableFilter, l: 'Penali', n: filteredEntries.filter(e => e.type === 'penali').length },
              ]).map(t => (
                <button
                  key={t.k}
                  onClick={() => setTableFilter(t.k)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    tableFilter === t.k
                      ? 'bg-theme-bg-primary text-theme-text-primary shadow-sm border border-theme-border'
                      : 'text-theme-text-secondary hover:text-theme-text-primary'
                  }`}
                >{t.l} <span className="text-theme-text-muted">{t.n}</span></button>
              ))}
            </div>
          }
        >
          {loading ? (
            <div className="py-12 text-center text-sm text-theme-text-muted">Caricamento…</div>
          ) : detailEntries.length === 0 ? (
            <div className="py-12 text-center text-sm text-theme-text-muted">Nessuna voce nel periodo selezionato.</div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-theme-bg-tertiary/40 border-y border-theme-border text-[10px] uppercase tracking-wide text-theme-text-secondary">
                      <th className="px-3 py-2.5 text-left font-medium">ID Pratica</th>
                      <th className="px-3 py-2.5 text-left font-medium">Data</th>
                      <th className="px-3 py-2.5 text-left font-medium">Tipo</th>
                      <th className="px-3 py-2.5 text-left font-medium">Categoria</th>
                      <th className="px-3 py-2.5 text-left font-medium">Cliente</th>
                      <th className="px-3 py-2.5 text-left font-medium">Veicolo</th>
                      <th className="px-3 py-2.5 text-left font-medium">Descrizione</th>
                      <th className="px-3 py-2.5 text-right font-medium">Importo</th>
                      <th className="px-3 py-2.5 text-left font-medium">Stato</th>
                      <th className="px-3 py-2.5 text-left font-medium">Servizio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((e) => (
                      <tr key={e.id} className="border-b border-theme-border last:border-0 hover:bg-theme-bg-hover/40">
                        <td className="px-3 py-2.5 font-mono text-[11px] text-theme-text-muted">{e.id.slice(0, 8).toUpperCase()}</td>
                        <td className="px-3 py-2.5 text-theme-text-secondary whitespace-nowrap">{fmtDate(e.date)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${TYPE_STYLES[e.type]}`}>
                            <span className={`w-1 h-1 rounded-full ${e.type === 'danni' ? 'bg-rose-500' : 'bg-orange-500'}`} />
                            {e.type === 'danni' ? 'Danno' : 'Penale'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-theme-text-primary">{e.category}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2 min-w-[140px]">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold ${avatarColor(e.customerName || e.vehiclePlate)}`}>
                              {initials(e.customerName)}
                            </span>
                            <span className="truncate text-theme-text-primary">{e.customerName || '—'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-theme-text-primary truncate max-w-[140px]">{e.vehicleName}</div>
                          <div className="text-[10px] text-theme-text-muted">{e.vehiclePlate}</div>
                        </td>
                        <td className="px-3 py-2.5 text-theme-text-secondary text-xs max-w-[220px] truncate" title={e.description}>{e.description}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-dr7-gold whitespace-nowrap">{fmtEur2(e.amount)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_STYLES[e.status].cls}`}>
                            {STATUS_STYLES[e.status].label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-theme-text-secondary capitalize">{e.serviceType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="pt-3 flex items-center justify-between text-xs text-theme-text-secondary">
                  <span>Mostra {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, detailEntries.length)} di {detailEntries.length}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                      className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary disabled:opacity-40 hover:bg-theme-bg-hover">‹</button>
                    {Array.from({ length: Math.min(totalPages, 6) }).map((_, i) => (
                      <button key={i} onClick={() => setPage(i + 1)}
                        className={`w-7 h-7 rounded text-xs font-medium ${page === i + 1 ? 'bg-dr7-gold text-white' : 'border border-theme-border bg-theme-bg-primary hover:bg-theme-bg-hover'}`}>{i + 1}</button>
                    ))}
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                      className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary disabled:opacity-40 hover:bg-theme-bg-hover">›</button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>

        {/* Top clienti */}
        <Card title="Top Clienti Danni & Penali" subtitle="Per importo totale">
          {topClienti.length === 0 ? (
            <div className="text-xs text-theme-text-muted py-6 text-center">Nessun cliente</div>
          ) : (
            <div className="space-y-2">
              {topClienti.map((c, i) => (
                <div key={c.name} className="flex items-center gap-2.5 py-1.5 border-b border-theme-border last:border-0">
                  <span className="text-[11px] font-bold text-theme-text-muted w-4">{i + 1}.</span>
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold ${avatarColor(c.name)}`}>{initials(c.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-theme-text-primary truncate">{c.name}</div>
                    <div className="text-[10px] text-theme-text-muted">{c.count} pratiche</div>
                  </div>
                  <span className="text-sm font-semibold text-dr7-gold whitespace-nowrap">{fmtEur(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Row 5: Impatto + Per veicolo + Confronto + Previsioni + Cause ─ */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Impatto Economico" subtitle="Contenzioso totale">
          <div className="flex flex-col items-center justify-center py-2">
            <div className="text-[11px] uppercase tracking-wide text-theme-text-muted">Totale</div>
            <div className="text-3xl font-bold text-theme-text-primary">{fmtEur(kpi.contenziosoTot)}</div>
            <div className="text-[11px] text-theme-text-muted mt-1">{filteredEntries.length} pratiche nel periodo</div>
          </div>
          {kpi.contenziosoTot > 0 && (
            <div className="mt-3">
              <div className="h-2 rounded-full overflow-hidden flex bg-theme-bg-tertiary">
                <div className="bg-rose-400" style={{ width: `${(kpi.danniTot / kpi.contenziosoTot) * 100}%` }} />
                <div className="bg-orange-400" style={{ width: `${(kpi.penaliTot / kpi.contenziosoTot) * 100}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-theme-text-muted mt-1.5">
                <span>Danni {Math.round((kpi.danniTot / kpi.contenziosoTot) * 100)}%</span>
                <span>Penali {Math.round((kpi.penaliTot / kpi.contenziosoTot) * 100)}%</span>
              </div>
            </div>
          )}
        </Card>

        <Card title="Danni e Penali per Veicolo" subtitle="Top 10 per importo" className="xl:col-span-2">
          {perVeicolo.length === 0 ? (
            <EmptyChart message="Nessun veicolo" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, perVeicolo.length * 26)}>
              <BarChart data={perVeicolo} layout="vertical" margin={{ left: 10, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} width={140} />
                <Tooltip formatter={(v) => fmtEur2(Number(v))} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={COLORS.gold} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Confronto Periodo" subtitle="vs periodo precedente">
          {!confronto ? (
            <div className="text-xs text-theme-text-muted py-6 text-center">Imposta un range per confronto</div>
          ) : (
            <div className="space-y-3">
              <ConfrontoRow label="Danni" cur={confronto.danni.current} pct={confronto.danni.pct} />
              <ConfrontoRow label="Penali" cur={confronto.penali.current} pct={confronto.penali.pct} />
              <ConfrontoRow label="Totale" cur={confronto.totale.current} pct={confronto.totale.pct} bold />
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Previsioni" subtitle="Proiezione prossimi 30 giorni (base ultimi 30g)">
          <div className="space-y-2">
            <div className="flex justify-between items-baseline py-2 border-b border-theme-border">
              <span className="text-sm text-theme-text-secondary">Danni Previsti</span>
              <span className="text-base font-semibold text-rose-600">{fmtEur(previsioni.danni)}</span>
            </div>
            <div className="flex justify-between items-baseline py-2 border-b border-theme-border">
              <span className="text-sm text-theme-text-secondary">Penali Previste</span>
              <span className="text-base font-semibold text-orange-600">{fmtEur(previsioni.penali)}</span>
            </div>
            <div className="flex justify-between items-baseline py-2 border-b border-theme-border">
              <span className="text-sm text-theme-text-secondary">Totale Previsto</span>
              <span className="text-base font-bold text-dr7-gold">{fmtEur(previsioni.totale)}</span>
            </div>
            <div className="flex justify-between items-baseline py-2">
              <span className="text-sm text-theme-text-secondary">Importo Medio</span>
              <span className="text-base font-semibold text-theme-text-primary">{fmtEur(previsioni.importoMedio)}</span>
            </div>
          </div>
        </Card>

        <Card title="Principali Cause di Danni e Penali" subtitle="Top 6 categorie" className="xl:col-span-2">
          {causeData.length === 0 ? (
            <EmptyChart message="Nessuna causa registrata" />
          ) : (
            <div className="flex flex-col lg:flex-row items-center gap-4">
              <div className="relative w-full lg:w-1/2">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={causeData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} dataKey="value" stroke="none">
                      {causeData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtEur2(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-[11px] uppercase tracking-wide text-theme-text-muted">Totale</div>
                  <div className="text-base font-bold text-theme-text-primary">{fmtEur(causeData.reduce((s, c) => s + c.value, 0))}</div>
                </div>
              </div>
              <div className="flex-1 w-full space-y-1.5">
                {causeData.map(c => (
                  <div key={c.name} className="flex items-center justify-between gap-3 py-1 border-b border-theme-border last:border-0">
                    <span className="inline-flex items-center gap-2 text-xs text-theme-text-primary">
                      <span className="w-2 h-2 rounded-full" style={{ background: c.fill }} />
                      {c.name}
                    </span>
                    <span className="text-xs font-semibold text-dr7-gold whitespace-nowrap">{fmtEur(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Footer with timestamp ─────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[11px] text-theme-text-muted pt-2">
        <span>Report aggiornato il {new Date().toLocaleString('it-IT', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        <span>{filteredEntries.length} pratiche nel periodo · {allEntries.length} totali</span>
      </div>
    </div>
  )
}

// ─── Reusable subcomponents ──────────────────────────────────────────────────
function Card({ title, subtitle, headerRight, children, className = '' }: {
  title: string
  subtitle?: string
  headerRight?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-theme-bg-primary border border-theme-border rounded-2xl p-5 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-theme-text-primary">{title}</h3>
          {subtitle && <p className="text-[11px] text-theme-text-muted mt-0.5">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      {children}
    </div>
  )
}

function KpiCard({ label, value, sub, accent, big }: {
  label: string
  value: string
  sub?: string
  accent: 'rose' | 'orange' | 'gold'
  big?: boolean
}) {
  const dotCls = accent === 'rose' ? 'bg-rose-500' : accent === 'orange' ? 'bg-orange-500' : 'bg-dr7-gold'
  return (
    <div className={`bg-theme-bg-primary border ${big ? 'border-dr7-gold/40 ring-1 ring-dr7-gold/10' : 'border-theme-border'} rounded-2xl p-4 shadow-sm`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`w-2 h-2 rounded-full ${dotCls}`} />
        <span className="text-[10px] uppercase tracking-wide font-medium text-theme-text-secondary">{label}</span>
      </div>
      <p className={`${big ? 'text-2xl' : 'text-xl'} font-bold text-theme-text-primary tracking-tight tabular-nums`}>{value}</p>
      {sub && <p className="text-[10px] text-theme-text-muted mt-1 truncate">{sub}</p>}
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return <div className="flex items-center justify-center h-[220px] text-xs text-theme-text-muted">{message}</div>
}

function ConfrontoRow({ label, cur, pct, bold }: { label: string; cur: number; pct: number | null; bold?: boolean }) {
  const positive = pct !== null && pct >= 0
  return (
    <div className={`flex items-center justify-between py-1.5 border-b border-theme-border last:border-0 ${bold ? 'font-semibold' : ''}`}>
      <span className="text-sm text-theme-text-secondary">{label}</span>
      <div className="text-right">
        <div className={`text-sm ${bold ? 'text-dr7-gold font-bold' : 'text-theme-text-primary'}`}>{fmtEur(cur)}</div>
        {pct !== null && (
          <div className={`text-[10px] font-medium ${positive ? 'text-rose-600' : 'text-emerald-600'}`}>
            {positive ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  )
}
