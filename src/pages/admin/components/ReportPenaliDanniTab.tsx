import { useState, useEffect, useMemo } from 'react'
import { ReportTable, ReportRow, ReportTotalRow, ReportEmpty } from './ReportUI'
import DateRangePicker, { resolveDateRange, isInRange, type DateRangeValue } from '../../../components/admin/DateRangePicker'
import toast from 'react-hot-toast'
// #38 Modifica manuale del report: correggi/rimuovi/aggiungi voci. Gli override
// (report_overrides) si applicano PRIMA dei totali, cosi' correzioni e rimozioni
// entrano anche nelle somme/KPI. Complementare al #35 (importi reali).
import { loadReportOverrides, applyOverrides, saveEditOverride, saveRemoveOverride, saveAddOverride, deleteOverrideByRow, deleteOverrideById, type LoadedOverrides } from '../../../utils/reportOverrides'
import { ReportRowModal, type FieldDef } from './ReportRowModal'

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

  // #38 Modifica manuale report
  const [overrides, setOverrides] = useState<LoadedOverrides>({ raw: [], removed: new Set(), edits: new Map(), added: [], notesByRow: new Map() })
  const [editReport, setEditReport] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editRow, setEditRow] = useState<any | null>(null)
  const [addMode, setAddMode] = useState(false)
  const EDIT_FIELDS: FieldDef[] = [{ key: 'amount', label: 'Importo €' }]

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
      setOverrides(await loadReportOverrides('penali_danni'))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  async function reloadOv() { setOverrides(await loadReportOverrides('penali_danni')) }
  async function saveEdit(changes: Record<string, number>, note: string) {
    if (!editRow) return
    for (const [field, value] of Object.entries(changes)) await saveEditOverride('penali_danni', editRow.id, field, value, note)
    setEditRow(null); await reloadOv(); toast.success('Voce corretta')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function saveAdd(row: any, note: string) {
    await saveAddOverride('penali_danni', { ...row, id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, date: new Date().toISOString() }, note)
    setAddMode(false); await reloadOv(); toast.success('Voce aggiunta')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function removeEntry(e: any) {
    if (!window.confirm('Rimuovere questa voce dal report?')) return
    if (e._isManual) await deleteOverrideById(e._manualId); else await saveRemoveOverride('penali_danni', e.id, null)
    await reloadOv(); toast.success('Voce rimossa')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function restoreEntry(e: any) {
    if (e._isManual) await deleteOverrideById(e._manualId); else await deleteOverrideByRow('penali_danni', e.id)
    await reloadOv(); toast.success('Voce ripristinata')
  }

  // ── Cutoff & filtered entries ─────────────────────────────────────────────
  const range = useMemo(() => resolveDateRange(dateRange), [dateRange])

  const rawEntries: Entry[] = useMemo(() => {
    const e: Entry[] = []
    if (penaliData?.entries) e.push(...penaliData.entries)
    if (danniData?.entries) e.push(...danniData.entries)
    return e
  }, [penaliData, danniData])

  // #38: applica gli override (correzioni/rimozioni/aggiunte) PRIMA dei totali.
  const allEntries: Entry[] = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return applyOverrides(rawEntries as any, overrides, (x: any) => x.id) as unknown as Entry[]
  }, [rawEntries, overrides])

  const filteredEntries: Entry[] = useMemo(() => {
    return allEntries.filter(e => isInRange(e.date, range))
  }, [allEntries, range])

  // Voci rimosse a mano nel periodo (ripristinabili in modalita' modifica).
  const removedEntries: Entry[] = useMemo(() =>
    rawEntries.filter(e => overrides.removed.has(e.id) && isInRange(e.date, range)),
    [rawEntries, overrides, range])

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
    const cutoff = range.from
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
  }, [range.from, allEntries])

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
            className="inline-flex items-center gap-2 px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary text-sm font-semibold rounded-full border border-theme-border hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
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
            Esporta CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* ── KPI cards (7) ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <KpiCard label="Danni Totali" value={fmtEur(kpi.danniTot)} accent="rose" sub="contestati e in liquidazione" />
        <KpiCard label="Penali Totali" value={fmtEur(kpi.penaliTot)} accent="orange" sub="aperte ed evase" />
        <KpiCard label="Totale Contenzioso" value={fmtEur(kpi.contenziosoTot)} accent="gold" sub="combinato" big />
        <KpiCard label="Danni Noleggio" value={fmtEur(kpi.danniNoleggio)} accent="rose" sub="parco veicoli" />
        <KpiCard label="Penali Noleggio" value={fmtEur(kpi.penaliNoleggio)} accent="orange" sub="violazioni contrattuali" />
        <KpiCard label="Danni Lavaggio" value={fmtEur(kpi.danniLavaggio)} accent="rose" sub="Lavaggio & Meccanica" />
        <KpiCard label="Penali Lavaggio" value={fmtEur(kpi.penaliLavaggio)} accent="orange" sub="Lavaggio & Meccanica" />
      </div>

      {/* ── Row 2: andamento + ripartizione + Azioni Rapide ──────────────
          2026-08-27 (richiesta direzione): stessa forma del Report Terra —
          tabelle, non grafici. Gli stessi numeri, nessun dato tolto. */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Andamento Danni e Penali" subtitle="Trend per periodo selezionato" className="xl:col-span-2" flush>
          {trendData.length === 0 ? (
            <ReportEmpty message="Nessun dato per il periodo" />
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <ReportTable
                head={
                  <>
                    <th className="text-left px-4 py-3">Periodo</th>
                    <th className="text-right px-4 py-3">Danni</th>
                    <th className="text-right px-4 py-3">Penali</th>
                    <th className="text-right px-4 py-3">Totale</th>
                  </>
                }
                foot={
                  <ReportTotalRow>
                    <td className="px-4 py-2">Totale</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtEur(trendData.reduce((s, t) => s + t.danni, 0))}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtEur(trendData.reduce((s, t) => s + t.penali, 0))}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-dr7-gold">{fmtEur(trendData.reduce((s, t) => s + t.totale, 0))}</td>
                  </ReportTotalRow>
                }
              >
                {trendData.map(t => (
                  <ReportRow key={t.month}>
                    <td className="px-4 py-2 text-theme-text-primary">{t.month}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(t.danni)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(t.penali)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-theme-text-primary">{fmtEur(t.totale)}</td>
                  </ReportRow>
                ))}
              </ReportTable>
            </div>
          )}
        </Card>

        <Card title="Ripartizione Danni vs Penali" subtitle="Volumi correnti" flush>
          {kpi.contenziosoTot === 0 ? (
            <ReportEmpty message="Nessun dato" />
          ) : (
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Tipo</th>
                  <th className="text-right px-4 py-3">Importo</th>
                  <th className="text-right px-4 py-3">%</th>
                </>
              }
              foot={
                <ReportTotalRow>
                  <td className="px-4 py-2">Totale</td>
                  <td className="px-4 py-2 text-right tabular-nums text-dr7-gold">{fmtEur(kpi.contenziosoTot)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">100%</td>
                </ReportTotalRow>
              }
            >
              {ripartizioneData.map(r => (
                <ReportRow key={r.name}>
                  <td className="px-4 py-2 text-theme-text-primary">{r.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(r.value)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted">
                    {kpi.contenziosoTot > 0 ? `${Math.round((r.value / kpi.contenziosoTot) * 100)}%` : '-'}
                  </td>
                </ReportRow>
              ))}
            </ReportTable>
          )}
        </Card>

        {/* Azioni Rapide */}
        <Card title="Azioni Rapide">
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

      {/* ── Row 3: per tipologia + stato pratiche + allerte ───────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Danni e Penali per Tipologia" subtitle="Distribuzione importi per causa" className="xl:col-span-2" flush>
          {tipologiaData.length === 0 ? (
            <ReportEmpty message="Nessun dato" />
          ) : (
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Tipologia</th>
                  <th className="text-right px-4 py-3">Importo</th>
                  <th className="text-right px-4 py-3">%</th>
                </>
              }
              foot={
                <ReportTotalRow>
                  <td className="px-4 py-2">Totale</td>
                  <td className="px-4 py-2 text-right tabular-nums text-dr7-gold">{fmtEur(tipologiaData.reduce((s, t) => s + t.value, 0))}</td>
                  <td className="px-4 py-2 text-right tabular-nums">100%</td>
                </ReportTotalRow>
              }
            >
              {tipologiaData.map(t => {
                const tot = tipologiaData.reduce((s, x) => s + x.value, 0)
                return (
                  <ReportRow key={t.name}>
                    <td className="px-4 py-2 text-theme-text-primary">{t.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(t.value)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted">{tot > 0 ? `${Math.round((t.value / tot) * 100)}%` : '-'}</td>
                  </ReportRow>
                )
              })}
            </ReportTable>
          )}
        </Card>

        <Card title="Stato Pratiche" subtitle="Aperte / risolte / annullate" flush>
          {statoData.length === 0 ? (
            <ReportEmpty message="Nessun dato" />
          ) : (
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Stato</th>
                  <th className="text-right px-4 py-3">Pratiche</th>
                </>
              }
              foot={
                <ReportTotalRow>
                  <td className="px-4 py-2">Totale</td>
                  <td className="px-4 py-2 text-right tabular-nums">{statoData.reduce((s, x) => s + x.value, 0)}</td>
                </ReportTotalRow>
              }
            >
              {statoData.map(s => (
                <ReportRow key={s.name}>
                  <td className="px-4 py-2 text-theme-text-primary">{s.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{s.value}</td>
                </ReportRow>
              ))}
            </ReportTable>
          )}
        </Card>

        <Card title="Allerte Critiche" subtitle={`${allerte.length} pratiche da gestire`} flush>
          {allerte.length === 0 ? (
            <ReportEmpty message="Nessuna allerta attiva" />
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <ReportTable
                head={
                  <>
                    <th className="text-left px-4 py-3">Cliente</th>
                    <th className="text-left px-4 py-3">Pratica</th>
                    <th className="text-center px-4 py-3">Giorni</th>
                    <th className="text-right px-4 py-3">Importo</th>
                  </>
                }
              >
                {allerte.map(a => (
                  <ReportRow key={a.id}>
                    <td className="px-4 py-2 text-theme-text-primary">{a.customerName || 'Cliente sconosciuto'}</td>
                    <td className="px-4 py-2 text-theme-text-secondary">{a.category} · {a.vehiclePlate}</td>
                    <td className={`px-4 py-2 text-center tabular-nums ${a.severity === 'high' ? 'text-red-500 font-semibold' : a.severity === 'medium' ? 'text-yellow-400' : 'text-theme-text-muted'}`}>{a.daysOld}g</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-theme-text-primary">{fmtEur(a.amount)}</td>
                  </ReportRow>
                ))}
              </ReportTable>
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
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button onClick={() => setEditReport(v => !v)} title="Correggi/rimuovi/aggiungi voci a mano"
                className={`px-3 py-1 text-xs font-medium rounded-full border ${editReport ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-theme-bg-tertiary/40 border-theme-border text-theme-text-secondary'}`}>
                {editReport ? '✓ Modifica report' : '✎ Modifica report'}
              </button>
              {editReport && (
                <button onClick={() => setAddMode(true)} className="px-3 py-1 text-xs font-medium rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">+ Voce</button>
              )}
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
                      {editReport && <th className="px-3 py-2.5 text-right font-medium">Azioni</th>}
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
                        <td className="px-3 py-2.5 text-right font-semibold text-dr7-gold whitespace-nowrap">
                          {fmtEur2(e.amount)}
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {(e as any)._overrideNote && <span className="ml-1 text-[11px] text-amber-400" title={(e as any)._overrideNote}>✎</span>}
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {(e as any)._isManual && <span className="ml-1 text-[10px] text-emerald-400" title="Voce aggiunta a mano">+</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_STYLES[e.status].cls}`}>
                            {STATUS_STYLES[e.status].label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-theme-text-secondary capitalize">{e.serviceType}</td>
                        {editReport && (
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <button onClick={() => setEditRow(e)} className="text-[11px] px-1.5 py-0.5 rounded bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary">Modifica</button>
                            <button onClick={() => removeEntry(e)} className="ml-1 text-[11px] px-1.5 py-0.5 rounded border border-red-500/40 text-red-400">Rimuovi</button>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {((e as any)._overrideNote && !(e as any)._isManual) && <button onClick={() => restoreEntry(e)} className="ml-1 text-[11px] px-1.5 py-0.5 rounded border border-theme-border text-theme-text-muted">Ripristina</button>}
                          </td>
                        )}
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
              {editReport && removedEntries.length > 0 && (
                <div className="pt-3 border-t border-theme-border mt-2">
                  <div className="text-[11px] text-theme-text-muted mb-1">Voci rimosse ({removedEntries.length}) — ripristinabili</div>
                  <div className="flex flex-col gap-1">
                    {removedEntries.map(e => (
                      <div key={e.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-theme-bg-tertiary/30 text-theme-text-muted">
                        <span className="truncate line-through">{e.type === 'danni' ? 'Danno' : 'Penale'} · {e.customerName || e.vehiclePlate} · {fmtEur2(e.amount)}</span>
                        <button onClick={() => restoreEntry(e)} className="ml-2 text-[11px] px-1.5 py-0.5 rounded border border-theme-border text-theme-text-secondary">Ripristina</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </Card>

        {/* Top clienti */}
        <Card title="Top Clienti Danni & Penali" subtitle="Per importo totale" flush>
          {topClienti.length === 0 ? (
            <ReportEmpty message="Nessun cliente" />
          ) : (
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">Cliente</th>
                  <th className="text-center px-4 py-3">Pratiche</th>
                  <th className="text-right px-4 py-3">Importo</th>
                </>
              }
            >
              {topClienti.map((c, i) => (
                <ReportRow key={c.name}>
                  <td className="px-4 py-2 tabular-nums text-theme-text-muted">{i + 1}</td>
                  <td className="px-4 py-2 text-theme-text-primary">{c.name}</td>
                  <td className="px-4 py-2 text-center tabular-nums text-theme-text-primary">{c.count}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-dr7-gold">{fmtEur(c.total)}</td>
                </ReportRow>
              ))}
            </ReportTable>
          )}
        </Card>
      </div>


      {/* ── Row 5: Impatto + Per veicolo + Confronto ──────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Impatto Economico" subtitle="Contenzioso totale" flush>
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
                <td className="px-4 py-2 text-right tabular-nums text-dr7-gold">{fmtEur(kpi.contenziosoTot)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{filteredEntries.length} pratiche</td>
              </ReportTotalRow>
            }
          >
            <ReportRow>
              <td className="px-4 py-2 text-theme-text-primary">Danni</td>
              <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(kpi.danniTot)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted">
                {kpi.contenziosoTot > 0 ? `${Math.round((kpi.danniTot / kpi.contenziosoTot) * 100)}%` : '-'}
              </td>
            </ReportRow>
            <ReportRow>
              <td className="px-4 py-2 text-theme-text-primary">Penali</td>
              <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(kpi.penaliTot)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted">
                {kpi.contenziosoTot > 0 ? `${Math.round((kpi.penaliTot / kpi.contenziosoTot) * 100)}%` : '-'}
              </td>
            </ReportRow>
          </ReportTable>
        </Card>

        <Card title="Danni e Penali per Veicolo" subtitle="Top 10 per importo" className="xl:col-span-2" flush>
          {perVeicolo.length === 0 ? (
            <ReportEmpty message="Nessun veicolo" />
          ) : (
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Veicolo</th>
                  <th className="text-right px-4 py-3">Importo</th>
                </>
              }
              foot={
                <ReportTotalRow>
                  <td className="px-4 py-2">Totale</td>
                  <td className="px-4 py-2 text-right tabular-nums text-dr7-gold">{fmtEur(perVeicolo.reduce((s, v) => s + v.value, 0))}</td>
                </ReportTotalRow>
              }
            >
              {perVeicolo.map(v => (
                <ReportRow key={v.name}>
                  <td className="px-4 py-2 text-theme-text-primary">{v.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(v.value)}</td>
                </ReportRow>
              ))}
            </ReportTable>
          )}
        </Card>

        <Card title="Confronto Periodo" subtitle="vs periodo precedente" flush>
          {!confronto ? (
            <ReportEmpty message="Imposta un range per confronto" />
          ) : (
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Voce</th>
                  <th className="text-right px-4 py-3">Periodo</th>
                  <th className="text-right px-4 py-3">Variazione</th>
                </>
              }
            >
              <ConfrontoRow label="Danni" cur={confronto.danni.current} pct={confronto.danni.pct} />
              <ConfrontoRow label="Penali" cur={confronto.penali.current} pct={confronto.penali.pct} />
              <ConfrontoRow label="Totale" cur={confronto.totale.current} pct={confronto.totale.pct} bold />
            </ReportTable>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Previsioni" subtitle="Proiezione prossimi 30 giorni (base ultimi 30g)" flush>
          <ReportTable
            head={
              <>
                <th className="text-left px-4 py-3">Voce</th>
                <th className="text-right px-4 py-3">Importo</th>
              </>
            }
            foot={
              <ReportTotalRow>
                <td className="px-4 py-2">Totale Previsto</td>
                <td className="px-4 py-2 text-right tabular-nums text-dr7-gold">{fmtEur(previsioni.totale)}</td>
              </ReportTotalRow>
            }
          >
            <ReportRow>
              <td className="px-4 py-2 text-theme-text-primary">Danni Previsti</td>
              <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(previsioni.danni)}</td>
            </ReportRow>
            <ReportRow>
              <td className="px-4 py-2 text-theme-text-primary">Penali Previste</td>
              <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(previsioni.penali)}</td>
            </ReportRow>
            <ReportRow>
              <td className="px-4 py-2 text-theme-text-primary">Importo Medio</td>
              <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(previsioni.importoMedio)}</td>
            </ReportRow>
          </ReportTable>
        </Card>

        <Card title="Principali Cause di Danni e Penali" subtitle="Top 6 categorie" className="xl:col-span-2" flush>
          {causeData.length === 0 ? (
            <ReportEmpty message="Nessuna causa registrata" />
          ) : (
            <ReportTable
              head={
                <>
                  <th className="text-left px-4 py-3">Causa</th>
                  <th className="text-right px-4 py-3">Importo</th>
                  <th className="text-right px-4 py-3">%</th>
                </>
              }
              foot={
                <ReportTotalRow>
                  <td className="px-4 py-2">Totale</td>
                  <td className="px-4 py-2 text-right tabular-nums text-dr7-gold">{fmtEur(causeData.reduce((s, c) => s + c.value, 0))}</td>
                  <td className="px-4 py-2 text-right tabular-nums">100%</td>
                </ReportTotalRow>
              }
            >
              {causeData.map(c => {
                const tot = causeData.reduce((s, x) => s + x.value, 0)
                return (
                  <ReportRow key={c.name}>
                    <td className="px-4 py-2 text-theme-text-primary">{c.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-primary">{fmtEur(c.value)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-theme-text-muted">{tot > 0 ? `${Math.round((c.value / tot) * 100)}%` : '-'}</td>
                  </ReportRow>
                )
              })}
            </ReportTable>
          )}
        </Card>
      </div>


      {/* ── Footer with timestamp ─────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[11px] text-theme-text-muted pt-2">
        <span>Report aggiornato il {new Date().toLocaleString('it-IT', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        <span>{filteredEntries.length} pratiche nel periodo · {allEntries.length} totali</span>
      </div>

      {(editRow || addMode) && (
        <ReportRowModal
          mode={addMode ? 'add' : 'edit'}
          row={editRow}
          fields={EDIT_FIELDS}
          identityFields={addMode ? [{ key: 'description', label: 'Descrizione', required: true }, { key: 'customerName', label: 'Cliente' }] : []}
          addTemplate={{ type: 'danni', serviceType: 'altro', status: 'paid', source: 'pending', category: 'Manuale', vehicleName: '—', vehiclePlate: '', description: '', customerName: '' }}
          onClose={() => { setEditRow(null); setAddMode(false) }}
          onSaveEdit={saveEdit}
          onSaveAdd={saveAdd}
        />
      )}
    </div>
  )
}

// ─── Reusable subcomponents ──────────────────────────────────────────────────
function Card({ title, subtitle, headerRight, children, className = '', flush = false }: {
  title: string
  subtitle?: string
  headerRight?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Contenuto tabellare: niente padding interno, come su Report Terra. */
  flush?: boolean
}) {
  return (
    <div className={`bg-theme-bg-secondary/50 border border-theme-border rounded-xl overflow-hidden ${className}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-theme-border">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-theme-text-primary">{title}</h3>
          {subtitle && <p className="text-[11px] text-theme-text-muted mt-0.5">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      {flush ? children : <div className="p-4">{children}</div>}
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
  // 2026-08-27: stessa scheda del Report Terra. L'accento resta solo come
  // bordo del riquadro, senza pallini colorati.
  const borderCls = big || accent === 'gold' ? 'border-dr7-gold/30' : 'border-theme-border'
  return (
    <div className={`bg-theme-bg-secondary/50 border ${borderCls} rounded-xl p-4`}>
      <p className="text-xs text-theme-text-muted">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${big || accent === 'gold' ? 'text-dr7-gold' : 'text-theme-text-primary'}`}>{value}</p>
      {sub && <p className="text-[10px] text-theme-text-muted mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

function ConfrontoRow({ label, cur, pct, bold }: { label: string; cur: number; pct: number | null; bold?: boolean }) {
  const positive = pct !== null && pct >= 0
  return (
    <ReportRow>
      <td className={`px-4 py-2 text-theme-text-primary ${bold ? 'font-bold' : ''}`}>{label}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${bold ? 'font-bold text-dr7-gold' : 'text-theme-text-primary'}`}>{fmtEur(cur)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${pct === null ? 'text-theme-text-muted' : positive ? 'text-red-500' : 'text-green-500'}`}>
        {pct === null ? '—' : `${positive ? '+' : '−'} ${Math.abs(pct).toFixed(1)}%`}
      </td>
    </ReportRow>
  )
}
