/**
 * IncomingInvoicesView — "Ricevute (Aruba)" body of FatturaTab.
 *
 * Mirrors the FatturaTab "Emesse" visual language (KPI strip + sidebar +
 * bottom charts) so the operator sees a consistent layout across both
 * sub-views. All API logic (Aruba fetch, per-row enrichment, download,
 * import-to-anagrafica) is unchanged from the previous version — only
 * the presentation is new.
 */
import { useEffect, useState, useMemo, useCallback, type ReactElement } from 'react'
import toast from 'react-hot-toast'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts'

interface IncomingInvoice {
  id: string
  filename: string
  invoiceNumber: string
  invoiceDate: string
  sender: string
  senderVat: string
  amount: number
  status: string
  receivedAt: string
  fornitore_id: string | null
  is_tracked: boolean
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtEur(n: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0)
}

function fmtDate(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

// ─── KpiCard (local copy, same visual language as FatturaTab) ───────────
type KpiTone = 'primary' | 'success' | 'warning' | 'info' | 'alert' | 'muted'
const KPI_TONE: Record<KpiTone, { ring: string; iconBg: string; iconText: string }> = {
  primary: { ring: 'border-dr7-gold/30', iconBg: 'bg-dr7-gold/15', iconText: 'text-dr7-gold' },
  success: { ring: 'border-emerald-500/30', iconBg: 'bg-emerald-500/15', iconText: 'text-emerald-400' },
  warning: { ring: 'border-amber-500/30', iconBg: 'bg-amber-500/15', iconText: 'text-amber-400' },
  info:    { ring: 'border-blue-500/30',   iconBg: 'bg-blue-500/15',   iconText: 'text-blue-400' },
  alert:   { ring: 'border-rose-500/30',   iconBg: 'bg-rose-500/15',   iconText: 'text-rose-400' },
  muted:   { ring: 'border-theme-border',  iconBg: 'bg-theme-bg-tertiary', iconText: 'text-theme-text-muted' },
}

const KPI_ICONS: Record<string, ReactElement> = {
  inbox:    <><path strokeWidth={2} strokeLinecap="round" d="M22 12h-6l-2 3h-4l-2-3H2"/><path strokeWidth={2} strokeLinejoin="round" d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></>,
  cash:     <><rect x="2" y="6" width="20" height="12" rx="2" strokeWidth={2}/><circle cx="12" cy="12" r="3" strokeWidth={2}/><path strokeWidth={2} d="M6 6v12M18 6v12"/></>,
  building: <><path strokeWidth={2} strokeLinecap="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/></>,
  link:     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l-3 3a4 4 0 11-5.66-5.66l3-3M14 10l3-3a4 4 0 015.66 5.66l-3 3M9 15l6-6"/>,
  ticket:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12V7a2 2 0 012-2h14a2 2 0 012 2v5a2 2 0 100 4v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 100-4z"/>,
  upload:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4"/>,
}

interface KpiCardProps {
  icon: keyof typeof KPI_ICONS
  label: string
  value: string
  delta?: number
  deltaIsPp?: boolean
  deltaSuffix?: string
  tone: KpiTone
}

function KpiCard({ icon, label, value, delta, deltaIsPp, deltaSuffix, tone }: KpiCardProps) {
  const t = KPI_TONE[tone]
  const showDelta = typeof delta === 'number' && Number.isFinite(delta)
  const positive = (delta ?? 0) >= 0
  const deltaTxt = showDelta
    ? `${positive ? '+' : ''}${(delta as number).toFixed(1)}${deltaIsPp ? 'pp' : '%'}`
    : null
  return (
    <div className={`bg-theme-bg-secondary border ${t.ring} rounded-xl p-4 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-lg ${t.iconBg} ${t.iconText} flex items-center justify-center`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{KPI_ICONS[icon]}</svg>
        </div>
        {deltaTxt && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
            positive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
            : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
          }`}>{deltaTxt}</span>
        )}
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wider text-theme-text-muted font-medium">{label}</p>
        <p className="text-2xl font-bold text-theme-text-primary mt-0.5 tabular-nums">{value}</p>
        {deltaSuffix && (
          <p className="text-[11px] text-theme-text-muted mt-1">{deltaSuffix}</p>
        )}
      </div>
    </div>
  )
}

export default function IncomingInvoicesView() {
  const [month, setMonth] = useState<string>(currentMonth())
  const [mode, setMode] = useState<'tracked' | 'all'>('all')
  const [invoices, setInvoices] = useState<IncomingInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [pageSize, setPageSize] = useState(15)
  const [currentPage, setCurrentPage] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/.netlify/functions/get-incoming-invoices?month=${month}&mode=${mode}`)
      const text = await res.text()
      let json: { success?: boolean; error?: string; invoices?: IncomingInvoice[] }
      try { json = JSON.parse(text) } catch {
        throw new Error(`HTTP ${res.status} (risposta non JSON, probabile timeout): ${text.slice(0, 200)}`)
      }
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setInvoices(json.invoices || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IncomingInvoicesView] error:', err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [month, mode])

  useEffect(() => { load() }, [load])

  // Progressive per-row enrichment — call detail endpoint for each row that's
  // missing amount/date/number. Sequential w/ small delay to respect Aruba rate
  // limits. Runs after invoices are loaded; cancels if month/mode changes.
  useEffect(() => {
    if (invoices.length === 0) return
    let cancelled = false

    async function enrichOne(filename: string): Promise<{ amount: number | null; invoiceDate: string; invoiceNumber: string } | null> {
      const res = await fetch(`/.netlify/functions/get-incoming-invoice-detail?filename=${encodeURIComponent(filename)}`)
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1500))
        return null
      }
      if (!res.ok) return null
      try {
        const json = await res.json()
        if (!json.success) return null
        return { amount: json.amount, invoiceDate: json.invoiceDate, invoiceNumber: json.invoiceNumber }
      } catch {
        return null
      }
    }

    ;(async () => {
      const eligible = invoices.filter(i => i.filename && (!i.amount || !i.invoiceDate || !i.invoiceNumber))
      console.log(`[IncomingInvoices] starting enrichment: ${eligible.length} of ${invoices.length} need details`)
      let done = 0
      for (const inv of invoices) {
        if (cancelled) return
        const needs = inv.filename && (!inv.amount || !inv.invoiceDate || !inv.invoiceNumber)
        if (!needs) continue
        const detail = await enrichOne(inv.filename)
        if (cancelled) return
        if (detail) {
          setInvoices(prev => prev.map(x => x.id === inv.id ? {
            ...x,
            amount: (detail.amount != null && (!x.amount || x.amount === 0)) ? detail.amount : x.amount,
            invoiceDate: x.invoiceDate || detail.invoiceDate || '',
            invoiceNumber: x.invoiceNumber || detail.invoiceNumber || '',
          } : x))
          done++
          if (done % 5 === 0) console.log(`[IncomingInvoices] enriched ${done}/${eligible.length}`)
        }
        await new Promise(r => setTimeout(r, 300))
      }
      console.log(`[IncomingInvoices] enrichment complete: ${done}/${eligible.length} populated`)
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, mode, invoices.length])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return invoices
    return invoices.filter(i =>
      i.sender.toLowerCase().includes(q) ||
      (i.senderVat || '').toLowerCase().includes(q) ||
      (i.invoiceNumber || '').toLowerCase().includes(q),
    )
  }, [invoices, search])

  // ─── Aggregations for KPIs / sidebar / charts ────────────────────────
  const aggregates = useMemo(() => {
    let trackedCount = 0
    let trackedAmount = 0
    let untrackedCount = 0
    let untrackedAmount = 0
    let totalAmount = 0
    const bySender = new Map<string, { count: number; total: number; tracked: boolean; vat: string }>()
    const byBucket = { '<€100': 0, '€100-500': 0, '€500-2000': 0, '>€2000': 0 }
    const dailyMap = new Map<string, number>()

    for (const i of filtered) {
      const amt = Number(i.amount) || 0
      totalAmount += amt
      if (i.is_tracked) {
        trackedCount++
        trackedAmount += amt
      } else {
        untrackedCount++
        untrackedAmount += amt
      }
      const key = (i.sender || '—').trim() || '—'
      const prev = bySender.get(key) || { count: 0, total: 0, tracked: false, vat: i.senderVat || '' }
      bySender.set(key, {
        count: prev.count + 1,
        total: prev.total + amt,
        tracked: prev.tracked || i.is_tracked,
        vat: prev.vat || i.senderVat || '',
      })
      if (amt < 100) byBucket['<€100']++
      else if (amt < 500) byBucket['€100-500']++
      else if (amt < 2000) byBucket['€500-2000']++
      else byBucket['>€2000']++

      if (i.invoiceDate) {
        const d = new Date(i.invoiceDate)
        if (!isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          dailyMap.set(key, (dailyMap.get(key) || 0) + amt)
        }
      }
    }

    const topSuppliers = Array.from(bySender.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total)

    const trackedRatio = filtered.length > 0 ? (trackedCount / filtered.length) * 100 : 0
    const avgTicket = filtered.length > 0 ? totalAmount / filtered.length : 0

    // Build per-day series for the month chart (ordered by date)
    const daily = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, total]) => {
        const d = new Date(key)
        return { day: String(d.getDate()).padStart(2, '0'), label: d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }), total }
      })

    return {
      total: filtered.length,
      totalAmount,
      trackedCount,
      trackedAmount,
      untrackedCount,
      untrackedAmount,
      uniqueSuppliers: bySender.size,
      trackedRatio,
      avgTicket,
      topSuppliers,
      byBucket,
      daily,
    }
  }, [filtered])

  // Pagination + filter reset
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(currentPage, totalPages - 1)
  const paged = useMemo(
    () => filtered.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filtered, safePage, pageSize],
  )
  useEffect(() => { setCurrentPage(0) }, [search, month, mode, pageSize])

  async function importToAnagrafica() {
    if (invoices.length === 0) {
      toast.error('Nessuna fattura da cui importare')
      return
    }
    const seen = new Map<string, { nome: string; piva: string | null }>()
    for (const inv of invoices) {
      const piva = (inv.senderVat || '').replace(/\D/g, '') || null
      const key = piva || `name:${(inv.sender || '').toLowerCase().trim()}`
      if (!key || !inv.sender) continue
      if (!seen.has(key)) seen.set(key, { nome: inv.sender, piva })
    }
    const suppliers = Array.from(seen.values())
    if (suppliers.length === 0) {
      toast.error('Nessun fornitore valido da importare')
      return
    }
    if (!window.confirm(`Aggiungere ${suppliers.length} fornitori all'anagrafica? I duplicati (stessa P.IVA o nome) verranno saltati.`)) {
      return
    }
    setImporting(true)
    try {
      const res = await fetch('/.netlify/functions/import-fornitori-from-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suppliers }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
      toast.success(`Aggiunti ${json.added} fornitori, ${json.skipped} gia' presenti`)
      load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Import fallito: ${msg}`)
    } finally {
      setImporting(false)
    }
  }

  async function downloadInvoice(inv: IncomingInvoice, kind: 'pdf' | 'xml') {
    if (!inv.filename) {
      toast.error('Filename mancante')
      return
    }
    setDownloading(inv.id + ':' + kind)
    try {
      const res = await fetch(`/.netlify/functions/get-incoming-invoices?action=download&filename=${encodeURIComponent(inv.filename)}`)
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
      const data = json.invoice || {}
      const base64 = kind === 'pdf' ? (data.pdf || data.pdfFile) : (data.file || data.xml)
      const mime = kind === 'pdf' ? 'application/pdf' : 'application/xml'
      const ext = kind === 'pdf' ? 'pdf' : 'xml'
      if (!base64) {
        toast.error(`${kind.toUpperCase()} non disponibile per questa fattura`)
        return
      }
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${inv.sender.replace(/[^a-zA-Z0-9]/g, '_')}_${inv.invoiceNumber || inv.filename}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Download fallito: ${msg}`)
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* ─── KPI strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard icon="inbox" label="Fatture Ricevute" value={String(aggregates.total)} deltaSuffix="nel periodo" tone="primary" />
        <KpiCard icon="cash" label="Spesa Totale" value={fmtEur(aggregates.totalAmount)} deltaSuffix="somma importi" tone="success" />
        <KpiCard icon="building" label="Fornitori Distinti" value={String(aggregates.uniqueSuppliers)} deltaSuffix="senders unici" tone="info" />
        <KpiCard icon="link" label="In Anagrafica" value={`${aggregates.trackedRatio.toFixed(0)}%`} deltaSuffix={`${aggregates.trackedCount} di ${aggregates.total}`} tone={aggregates.trackedRatio >= 80 ? 'success' : aggregates.trackedRatio >= 50 ? 'info' : 'warning'} />
        <KpiCard icon="ticket" label="Ticket Medio" value={fmtEur(aggregates.avgTicket)} deltaSuffix="importo per fattura" tone="muted" />
        <KpiCard icon="upload" label="Da Importare" value={String(aggregates.untrackedCount)} deltaSuffix={fmtEur(aggregates.untrackedAmount)} tone="alert" />
      </div>

      {/* ─── Filters ─────────────────────────────────────────── */}
      <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] text-theme-text-muted uppercase tracking-wider mb-1">Mese</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
            />
          </div>
          <div>
            <label className="block text-[10px] text-theme-text-muted uppercase tracking-wider mb-1">Filtro fornitori</label>
            <div className="flex bg-theme-bg-tertiary border border-theme-border rounded overflow-hidden">
              <button
                type="button"
                onClick={() => setMode('tracked')}
                className={`px-3 py-2 text-sm ${mode === 'tracked' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
              >
                Solo in anagrafica
              </button>
              <button
                type="button"
                onClick={() => setMode('all')}
                className={`px-3 py-2 text-sm border-l border-theme-border ${mode === 'all' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
              >
                Tutti
              </button>
            </div>
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[10px] text-theme-text-muted uppercase tracking-wider mb-1">Cerca</label>
            <input
              type="text"
              placeholder="Fornitore, P.IVA, numero fattura..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
            />
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="px-4 py-2 rounded-full bg-dr7-gold text-black font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? 'Caricamento...' : 'Aggiorna'}
          </button>
          <button
            onClick={importToAnagrafica}
            disabled={importing || invoices.length === 0}
            className="px-4 py-2 rounded-full bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Aggiungi tutti i fornitori visibili all'Anagrafica Fornitori, evitando i duplicati"
          >
            {importing ? 'Importo...' : `Importa ${invoices.length} in Anagrafica`}
          </button>
        </div>
      </div>

      {/* ─── Body: table + sidebar ─────────────────────────────── */}
      {error ? (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-300 text-sm">
          <p className="font-semibold mb-1">Errore Aruba</p>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">{error}</pre>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">

          {/* Main column */}
          <div className="xl:col-span-9 space-y-4 min-w-0">
            {loading ? (
              <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-12 text-center text-theme-text-muted text-sm">
                Caricamento da Aruba...
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-theme-bg-secondary rounded-xl border border-theme-border p-12 text-center text-theme-text-muted text-sm">
                Nessuna fattura ricevuta nel periodo {mode === 'tracked' ? 'per i fornitori in anagrafica' : ''}.
                {mode === 'tracked' && ' Prova "Tutti" per vedere ogni fattura ricevuta.'}
              </div>
            ) : (
              <div className="bg-theme-bg-secondary rounded-xl border border-theme-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-theme-bg-tertiary/50 text-theme-text-muted text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Data</th>
                        <th className="px-4 py-3 text-left font-medium">Fornitore</th>
                        <th className="px-4 py-3 text-left font-medium">P.IVA</th>
                        <th className="px-4 py-3 text-left font-medium">N. Fattura</th>
                        <th className="px-4 py-3 text-right font-medium">Importo</th>
                        <th className="px-4 py-3 text-left font-medium">Anagrafica</th>
                        <th className="px-4 py-3 text-right font-medium">Azioni</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border">
                      {paged.map(inv => (
                        <tr key={inv.id} className="hover:bg-theme-bg-tertiary/30 transition-colors">
                          <td className="px-4 py-3 text-theme-text-secondary whitespace-nowrap">{fmtDate(inv.invoiceDate)}</td>
                          <td className="px-4 py-3 max-w-[220px]">
                            <div className="text-theme-text-primary font-medium truncate" title={inv.sender}>{inv.sender}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-theme-text-secondary text-xs">{inv.senderVat || '—'}</td>
                          <td className="px-4 py-3 text-theme-text-secondary">{inv.invoiceNumber || '—'}</td>
                          <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold text-theme-text-primary">{fmtEur(inv.amount)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {inv.is_tracked ? (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">In anagrafica</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-amber-500/10 text-amber-400 border-amber-500/30">Non collegato</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button
                              onClick={() => downloadInvoice(inv, 'pdf')}
                              disabled={downloading === inv.id + ':pdf'}
                              className="text-xs px-2.5 py-1 rounded-full bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary mr-1 disabled:opacity-50 transition-colors"
                            >
                              {downloading === inv.id + ':pdf' ? '...' : 'PDF'}
                            </button>
                            <button
                              onClick={() => downloadInvoice(inv, 'xml')}
                              disabled={downloading === inv.id + ':xml'}
                              className="text-xs px-2.5 py-1 rounded-full bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary disabled:opacity-50 transition-colors"
                            >
                              {downloading === inv.id + ':xml' ? '...' : 'XML'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination footer */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-theme-bg-tertiary/30 border-t border-theme-border text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-theme-text-muted">Mostra</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-theme-text-primary"
                    >
                      {[15, 30, 60, 100].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span className="text-theme-text-muted">risultati</span>
                  </div>
                  <div className="text-theme-text-muted">
                    {filtered.length === 0
                      ? '0'
                      : `${safePage * pageSize + 1} - ${Math.min((safePage + 1) * pageSize, filtered.length)} di ${filtered.length} fatture`}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(0)}
                      disabled={safePage === 0}
                      className="px-2 py-1 rounded border border-theme-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed"
                    >«</button>
                    <button
                      onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      className="px-2 py-1 rounded border border-theme-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed"
                    >‹</button>
                    {(() => {
                      const pages: number[] = []
                      const start = Math.max(0, Math.min(safePage - 2, totalPages - 5))
                      const end = Math.min(totalPages, start + 5)
                      for (let i = start; i < end; i++) pages.push(i)
                      return pages.map(i => (
                        <button
                          key={i}
                          onClick={() => setCurrentPage(i)}
                          className={`min-w-[28px] px-2 py-1 rounded border text-xs ${
                            i === safePage
                              ? 'bg-dr7-gold text-black border-dr7-gold font-semibold'
                              : 'border-theme-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary'
                          }`}
                        >{i + 1}</button>
                      ))
                    })()}
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={safePage >= totalPages - 1}
                      className="px-2 py-1 rounded border border-theme-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed"
                    >›</button>
                    <button
                      onClick={() => setCurrentPage(totalPages - 1)}
                      disabled={safePage >= totalPages - 1}
                      className="px-2 py-1 rounded border border-theme-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed"
                    >»</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="xl:col-span-3 space-y-4 min-w-0">
            {/* Riepilogo Spese — tracked vs untracked */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-theme-text-primary">Riepilogo Spese</h3>
                <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">Periodo</span>
              </div>
              {(() => {
                const total = aggregates.totalAmount
                const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0
                return (
                  <>
                    <div className="text-2xl font-bold text-theme-text-primary tabular-nums">{fmtEur(total)}</div>
                    <div className="text-[11px] text-theme-text-muted mb-3">Spesa fornitori del periodo</div>
                    <div className="flex h-2 rounded-full overflow-hidden bg-theme-bg-tertiary mb-3">
                      <div className="bg-emerald-500" style={{ width: `${pct(aggregates.trackedAmount)}%` }} />
                      <div className="bg-amber-500" style={{ width: `${pct(aggregates.untrackedAmount)}%` }} />
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" />In anagrafica</span><span className="tabular-nums text-theme-text-primary">{fmtEur(aggregates.trackedAmount)} <span className="text-theme-text-muted">({pct(aggregates.trackedAmount)}%)</span></span></div>
                      <div className="flex justify-between"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500" />Non collegate</span><span className="tabular-nums text-theme-text-primary">{fmtEur(aggregates.untrackedAmount)} <span className="text-theme-text-muted">({pct(aggregates.untrackedAmount)}%)</span></span></div>
                    </div>
                  </>
                )
              })()}
            </div>

            {/* Top Fornitori */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Top Fornitori</h3>
              {aggregates.topSuppliers.length === 0 ? (
                <p className="text-xs text-theme-text-muted italic">Nessun dato.</p>
              ) : (
                <ul className="space-y-2">
                  {aggregates.topSuppliers.slice(0, 5).map(s => (
                    <li key={s.name} className="flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-theme-text-primary truncate" title={s.name}>{s.name}</p>
                        <p className="text-theme-text-muted text-[11px]">{s.count} fattur{s.count === 1 ? 'a' : 'e'}</p>
                      </div>
                      <p className="tabular-nums text-theme-text-primary shrink-0 font-semibold">{fmtEur(s.total)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Da Importare */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-theme-text-primary">Da Importare</h3>
                <span className="text-[10px] uppercase tracking-wider text-amber-400">{aggregates.untrackedCount}</span>
              </div>
              {aggregates.untrackedCount === 0 ? (
                <p className="text-xs text-theme-text-muted italic">Tutti i fornitori del periodo sono già in anagrafica.</p>
              ) : (
                <>
                  <p className="text-xs text-theme-text-muted mb-3">{aggregates.untrackedCount} fattur{aggregates.untrackedCount === 1 ? 'a senza fornitore in anagrafica' : 'e da collegare'} ({fmtEur(aggregates.untrackedAmount)}).</p>
                  <button
                    onClick={importToAnagrafica}
                    disabled={importing}
                    className="w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {importing ? 'Importo...' : 'Importa in Anagrafica'}
                  </button>
                </>
              )}
            </div>

            {/* Azioni Rapide */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Azioni Rapide</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button onClick={load} disabled={loading} className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg px-3 py-2 text-left disabled:opacity-50">
                  <div className="font-semibold">Ricarica Aruba</div>
                  <div className="text-[10px] text-theme-text-muted">Stessi filtri</div>
                </button>
                <button onClick={() => setMonth(currentMonth())} className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg px-3 py-2 text-left">
                  <div className="font-semibold">Mese corrente</div>
                  <div className="text-[10px] text-theme-text-muted">Reset mese</div>
                </button>
                <button onClick={() => setMode('tracked')} className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg px-3 py-2 text-left">
                  <div className="font-semibold">Solo collegati</div>
                  <div className="text-[10px] text-theme-text-muted">Anagrafica</div>
                </button>
                <button onClick={() => setMode('all')} className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg px-3 py-2 text-left">
                  <div className="font-semibold">Tutti</div>
                  <div className="text-[10px] text-theme-text-muted">Senza filtro</div>
                </button>
                <button onClick={() => { setSearch(''); setMode('all'); setMonth(currentMonth()) }} className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg px-3 py-2 text-left col-span-2">
                  <div className="font-semibold">Reset filtri</div>
                  <div className="text-[10px] text-theme-text-muted">Tutto, mese corrente</div>
                </button>
              </div>
            </div>

            {/* Distribuzione per Importo */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Distribuzione per Importo</h3>
              <ul className="space-y-1.5 text-xs">
                {(['<€100', '€100-500', '€500-2000', '>€2000'] as const).map((bucket, idx) => {
                  const count = aggregates.byBucket[bucket]
                  const max = Math.max(1, ...Object.values(aggregates.byBucket))
                  const pct = (count / max) * 100
                  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500']
                  return (
                    <li key={bucket}>
                      <div className="flex justify-between mb-0.5">
                        <span className="text-theme-text-muted">{bucket}</span>
                        <span className="tabular-nums text-theme-text-primary font-semibold">{count}</span>
                      </div>
                      <div className="h-1.5 bg-theme-bg-tertiary rounded-full overflow-hidden">
                        <div className={`h-full ${colors[idx]}`} style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </aside>
        </div>
      )}

      {/* ─── Bottom: 3 charts ──────────────────────────────────── */}
      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Andamento giornaliero del periodo */}
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Andamento Spese (mese)</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={aggregates.daily} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="incomingDaily" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#374151" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} formatter={(v) => fmtEur(Number(v) || 0)} labelFormatter={(d) => `Giorno ${d}`} />
                  <Area type="monotone" dataKey="total" stroke="#3b82f6" fill="url(#incomingDaily)" strokeWidth={2} name="Spesa giornaliera" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top Fornitori bar chart */}
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Top Fornitori per Spesa</h3>
            {aggregates.topSuppliers.length === 0 ? (
              <p className="text-xs text-theme-text-muted italic py-8 text-center">Nessun dato.</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={aggregates.topSuppliers.slice(0, 5)} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid stroke="#374151" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                    <YAxis dataKey="name" type="category" stroke="#9ca3af" fontSize={11} width={120} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} formatter={(v) => fmtEur(Number(v) || 0)} />
                    <Bar dataKey="total" fill="#d4af37" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Tracked vs Non collegate (donut) */}
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Anagrafica Coverage</h3>
            <div className="relative h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'In anagrafica', value: aggregates.trackedCount },
                      { name: 'Non collegate', value: aggregates.untrackedCount },
                    ]}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={2}
                    stroke="none"
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#f59e0b" />
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-2xl font-bold text-theme-text-primary tabular-nums">{aggregates.trackedRatio.toFixed(0)}%</p>
                <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Coverage</p>
              </div>
            </div>
            <div className="space-y-1 text-xs mt-2">
              <div className="flex justify-between"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" />In anagrafica</span><span className="tabular-nums">{aggregates.trackedCount}</span></div>
              <div className="flex justify-between"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500" />Non collegate</span><span className="tabular-nums">{aggregates.untrackedCount}</span></div>
              <div className="flex justify-between border-t border-theme-border pt-1 mt-1"><span className="text-theme-text-muted">Totale</span><span className="tabular-nums font-semibold">{aggregates.total}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
