import { useState, useEffect, useMemo, type ReactElement } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildFatturaContext } from '../../../utils/adminLogHelpers'
import { authFetch } from '../../../utils/authFetch'
import { useAdminRole } from '../../../hooks/useAdminRole'
import IncomingInvoicesView from './IncomingInvoicesView'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'

interface Invoice {
  id: string
  numero_fattura: string
  data_emissione: string
  data_scadenza?: string | null
  importo_totale: number
  stato: string
  customer_name: string
  customer_email?: string
  customer_phone?: string
  customer_address?: string
  customer_tax_code?: string
  customer_vat?: string
  booking_id?: string
  invoice_html?: string
  items?: InvoiceItem[]
  subtotal?: number
  vat_amount?: number
  exempt_amount?: number
  created_at: string
  updated_at?: string
  // SDI fields
  sdi_status?: 'draft' | 'sending' | 'sent' | 'accepted' | 'rejected' | 'scartata' | 'error'
  sdi_id?: string
  sdi_sent_at?: string
  sdi_notification_seen?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sdi_response?: any
  customer_sdi_code?: string
  customer_pec?: string
  // Nota di credito
  tipo_fattura?: string
  related_invoice_id?: string
}

interface InvoiceItem {
  description: string
  unit_price: number
  quantity: number
  vat_rate: number
  total: number
}

// Chi può cambiare lo stato di pagamento delle fatture: il flag `role:payment-manager`
// in admins.permissions, oppure il failsafe direzione (valerio/ilenia). Modifica
// dalla direzione via OperatoriTab.

function formatEur(n: number): string {
  if (!Number.isFinite(n)) return '€0,00'
  return `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

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
  up:        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l6-6 4 4 8-8m0 0v6m0-6h-6" />,
  check:     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />,
  hourglass: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 2h12M6 22h12M6 2v4a6 6 0 006 6 6 6 0 006-6V2M6 22v-4a6 6 0 016-6 6 6 0 016 6v4" />,
  percent:   <><circle cx="6.5" cy="6.5" r="2.5" strokeWidth={2}/><circle cx="17.5" cy="17.5" r="2.5" strokeWidth={2}/><path strokeLinecap="round" strokeWidth={2} d="M5 19L19 5"/></>,
  clock:     <><circle cx="12" cy="12" r="9" strokeWidth={2}/><path strokeLinecap="round" strokeWidth={2} d="M12 7v5l3 2"/></>,
  calendar:  <><rect x="3" y="5" width="18" height="16" rx="2" strokeWidth={2}/><path strokeWidth={2} d="M3 10h18M8 3v4M16 3v4"/></>,
}

interface KpiCardProps {
  icon: keyof typeof KPI_ICONS
  label: string
  value: string
  delta?: number       // percent variation vs comparator
  deltaIsPp?: boolean  // if true, delta is in percentage points (not %)
  deltaSuffix?: string // e.g. "vs mese scorso"
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
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {KPI_ICONS[icon]}
          </svg>
        </div>
        {deltaTxt && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
            positive
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
          }`}>
            {deltaTxt}
          </span>
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

// ─── Bottom-row charts ─────────────────────────────────────────────
// Tutti e tre leggono dalla stessa lista invoices già caricata: niente
// query extra. Aggregazioni lato client (lista è in memoria comunque).

interface ChartInvoice {
  numero_fattura: string
  data_emissione: string
  data_scadenza?: string | null
  importo_totale: number
  stato: string
  customer_name: string
  tipo_fattura?: string
}

function FatturaTrendChart({ invoices }: { invoices: ChartInvoice[] }) {
  const data = useMemo(() => {
    const months: { key: string; label: string; emesso: number; incassato: number }[] = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      months.push({ key, label: d.toLocaleDateString('it-IT', { month: 'short' }), emesso: 0, incassato: 0 })
    }
    for (const inv of invoices) {
      if (inv.tipo_fattura === 'nota_credito') continue
      const d = inv.data_emissione ? new Date(inv.data_emissione) : null
      if (!d) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const m = months.find(x => x.key === key)
      if (!m) continue
      const total = Number(inv.importo_totale) || 0
      m.emesso += total
      if (inv.stato === 'paid') m.incassato += total
    }
    return months
  }, [invoices])

  return (
    <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
      <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Andamento Fatturato (ultimi 6 mesi)</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="fatturaEmesso" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#d4af37" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#d4af37" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fatturaIncassato" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#374151" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
            <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} formatter={(v: unknown) => formatEur(Number(v) || 0)} />
            <Area type="monotone" dataKey="emesso" stroke="#d4af37" fill="url(#fatturaEmesso)" strokeWidth={2} name="Emesso" />
            <Area type="monotone" dataKey="incassato" stroke="#10b981" fill="url(#fatturaIncassato)" strokeWidth={2} name="Incassato" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 text-[11px] mt-2">
        <span className="flex items-center gap-1.5 text-theme-text-muted"><span className="w-2 h-2 rounded-full bg-dr7-gold" />Emesso</span>
        <span className="flex items-center gap-1.5 text-theme-text-muted"><span className="w-2 h-2 rounded-full bg-emerald-500" />Incassato</span>
      </div>
    </div>
  )
}

function TopClientiChart({ invoices }: { invoices: ChartInvoice[] }) {
  const data = useMemo(() => {
    const map = new Map<string, number>()
    for (const inv of invoices) {
      if (inv.tipo_fattura === 'nota_credito') continue
      const name = (inv.customer_name || '—').trim() || '—'
      const total = Number(inv.importo_totale) || 0
      map.set(name, (map.get(name) || 0) + total)
    }
    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [invoices])

  return (
    <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
      <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Top Clienti per Fatturato</h3>
      {data.length === 0 ? (
        <p className="text-xs text-theme-text-muted italic py-8 text-center">Nessun dato.</p>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid stroke="#374151" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
              <YAxis dataKey="name" type="category" stroke="#9ca3af" fontSize={11} width={120} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} formatter={(v: unknown) => formatEur(Number(v) || 0)} />
              <Bar dataKey="total" fill="#d4af37" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function AnalisiIncassiChart({ invoices }: { invoices: ChartInvoice[] }) {
  const { data, totale, incassato, daIncassare, pct } = useMemo(() => {
    let inc = 0, da = 0
    for (const i of invoices) {
      if (i.tipo_fattura === 'nota_credito') continue
      if (i.stato === 'cancelled') continue
      const total = Number(i.importo_totale) || 0
      if (i.stato === 'paid') inc += total
      else da += total
    }
    const tot = inc + da
    return {
      data: [
        { name: 'Incassato', value: inc },
        { name: 'Da incassare', value: da },
      ],
      totale: tot,
      incassato: inc,
      daIncassare: da,
      pct: tot > 0 ? (inc / tot) * 100 : 0,
    }
  }, [invoices])

  const COLORS = ['#10b981', '#f59e0b']

  return (
    <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
      <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Analisi Incassi</h3>
      <div className="relative h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={2} stroke="none">
              {data.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} formatter={(v: unknown) => formatEur(Number(v) || 0)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-2xl font-bold text-theme-text-primary tabular-nums">{pct.toFixed(1)}%</p>
          <p className="text-[10px] uppercase tracking-wider text-theme-text-muted">Incassato</p>
        </div>
      </div>
      <div className="space-y-1 text-xs mt-2">
        <div className="flex justify-between"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" />Incassato</span><span className="tabular-nums">{formatEur(incassato)}</span></div>
        <div className="flex justify-between"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500" />Da incassare</span><span className="tabular-nums">{formatEur(daIncassare)}</span></div>
        <div className="flex justify-between border-t border-theme-border pt-1 mt-1"><span className="text-theme-text-muted">Totale</span><span className="tabular-nums font-semibold">{formatEur(totale)}</span></div>
      </div>
    </div>
  )
}

// Default scadenza fattura quando non e' specificata: 30 giorni dall'emissione
const DEFAULT_PAYMENT_TERM_DAYS = 30

function getInvoiceDueDate(inv: { data_emissione: string; data_scadenza?: string | null }): Date | null {
  if (inv.data_scadenza) {
    const d = new Date(inv.data_scadenza)
    if (!isNaN(d.getTime())) return d
  }
  if (inv.data_emissione) {
    const d = new Date(inv.data_emissione)
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() + DEFAULT_PAYMENT_TERM_DAYS)
      return d
    }
  }
  return null
}

function isInvoiceOverdue(inv: { data_emissione: string; data_scadenza?: string | null; stato: string }): boolean {
  if (inv.stato === 'paid' || inv.stato === 'cancelled') return false
  const due = getInvoiceDueDate(inv)
  if (!due) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due < today
}

function daysOverdue(inv: { data_emissione: string; data_scadenza?: string | null }): number {
  const due = getInvoiceDueDate(inv)
  if (!due) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000))
}

export default function FatturaTab() {
  const [view, setView] = useState<'emesse' | 'ricevute'>('emesse')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingStatus, setCheckingStatus] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSdi, setFilterSdi] = useState<'all' | 'sending' | 'sent' | 'accepted' | 'rejected' | 'error' | 'draft'>('all')
  const [filterTipo, setFilterTipo] = useState<'all' | 'fattura' | 'nota_credito'>('all')
  const [filterDateFrom, setFilterDateFrom] = useState<string>('')
  const [filterDateTo, setFilterDateTo] = useState<string>('')
  const [filterCliente, setFilterCliente] = useState<string>('all')
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(0)
  const [openActionsId, setOpenActionsId] = useState<string | null>(null)

  // Lista clienti unici dalle fatture caricate, alfabetica.
  const clientiOptions = useMemo(() => {
    const set = new Set<string>()
    for (const inv of invoices) {
      const name = (inv.customer_name || '').trim()
      if (name) set.add(name)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }))
  }, [invoices])

  // Filter pipeline — single source of truth for both the table rows and
  // the pagination counter. Resetting the page when filters change avoids
  // landing on an empty page.
  const filteredInvoices = useMemo(() => {
    return invoices.filter(invoice => {
      if (filterCliente !== 'all' && invoice.customer_name !== filterCliente) return false
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesText = (
          invoice.customer_name.toLowerCase().includes(query) ||
          invoice.numero_fattura.toLowerCase().includes(query) ||
          (invoice.customer_email && invoice.customer_email.toLowerCase().includes(query))
        )
        if (!matchesText) return false
      }
      if (filterSdi !== 'all') {
        const status = invoice.sdi_status || 'draft'
        if (filterSdi === 'rejected') {
          if (status !== 'rejected' && status !== 'scartata') return false
        } else if (status !== filterSdi) {
          return false
        }
      }
      if (filterTipo !== 'all') {
        const isNotaCredito = invoice.tipo_fattura === 'nota_credito' || invoice.tipo_fattura === 'TD04'
        if (filterTipo === 'nota_credito' && !isNotaCredito) return false
        if (filterTipo === 'fattura' && isNotaCredito) return false
      }
      if (filterDateFrom || filterDateTo) {
        const issueDate = (invoice.data_emissione || '').slice(0, 10)
        if (filterDateFrom && issueDate < filterDateFrom) return false
        if (filterDateTo && issueDate > filterDateTo) return false
      }
      return true
    })
  }, [invoices, filterCliente, searchQuery, filterSdi, filterTipo, filterDateFrom, filterDateTo])

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize))
  const safePage = Math.min(currentPage, totalPages - 1)
  const pagedInvoices = useMemo(
    () => filteredInvoices.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filteredInvoices, safePage, pageSize],
  )

  // Reset to page 0 whenever a filter changes — keeps the operator from
  // staring at an empty page after a narrow filter.
  useEffect(() => { setCurrentPage(0) }, [filterCliente, searchQuery, filterSdi, filterTipo, filterDateFrom, filterDateTo, pageSize])

  // ─── KPI metrics ─────────────────────────────────────────────────────
  // Calcoli derivati dalle fatture caricate. Confronto vs mese precedente
  // per i delta. Tutti i valori escludono note di credito (tipo_fattura =
  // 'nota_credito') quando si tratta di "fatturato emesso".
  const kpis = useMemo(() => {
    const now = new Date()
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const startNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    const eur = (n: number) => n
    const isFattura = (i: Invoice) => i.tipo_fattura !== 'nota_credito'

    let emesso = 0, emessoPrev = 0
    let incassato = 0, incassatoPrev = 0
    let daIncassare = 0
    let inScadenza = 0
    let pagamentiProgrammati = 0

    const in7Days = new Date(now.getTime() + 7 * 86400000)

    for (const inv of invoices) {
      if (!isFattura(inv)) continue
      const issued = inv.data_emissione ? new Date(inv.data_emissione) : null
      const total = Number(inv.importo_totale) || 0

      // Fatturato emesso (mese corrente / mese precedente)
      if (issued && issued >= startThisMonth) emesso += total
      else if (issued && issued >= startPrevMonth && issued < startThisMonth) emessoPrev += total

      // Incassato vs da incassare (stato='paid' = incassato)
      if (inv.stato === 'paid') {
        if (issued && issued >= startThisMonth) incassato += total
        else if (issued && issued >= startPrevMonth && issued < startThisMonth) incassatoPrev += total
      } else if (inv.stato !== 'cancelled') {
        daIncassare += total
        const due = getInvoiceDueDate(inv)
        if (due) {
          // Scadenza nei prossimi 7 giorni (incluso oggi, escluso passato)
          if (due >= now && due <= in7Days) inScadenza += 1
          // Pagamenti programmati = fatture non pagate con scadenza nel mese corrente
          if (due >= startThisMonth && due < startNextMonth) pagamentiProgrammati += 1
        }
      }
    }

    const totaleAtteso = emesso // fatturato del mese corrente
    const incassoPct = totaleAtteso > 0 ? (incassato / totaleAtteso) * 100 : 0
    const incassoPctPrev = emessoPrev > 0 ? (incassatoPrev / emessoPrev) * 100 : 0

    const deltaPct = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0
      return ((curr - prev) / prev) * 100
    }

    return {
      emesso: eur(emesso),
      emessoDeltaPct: deltaPct(emesso, emessoPrev),
      incassato: eur(incassato),
      incassatoDeltaPct: deltaPct(incassato, incassatoPrev),
      daIncassare: eur(daIncassare),
      incassoPct,
      incassoPctDeltaPct: incassoPct - incassoPctPrev,
      inScadenza,
      pagamentiProgrammati,
    }
  }, [invoices])
  const [creatingNdc, setCreatingNdc] = useState<string | null>(null)
  const { hasRole } = useAdminRole()
  const canManagePayments = hasRole('payment-manager')
  const [updatingStato, setUpdatingStato] = useState<string | null>(null)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [lastSdiRefresh, setLastSdiRefresh] = useState<number | null>(null)

  // Refresh stati SDI per TUTTE le fatture in 'sending'/'sent' su Aruba e
  // ricarica la lista. Manuale (bottone) o automatico (mount + ogni 60s).
  // Throttle: salta se l'ultima chiamata è < 30s fa, per non sparare richieste
  // ad Aruba a ogni focus.
  async function refreshAllSdi(opts: { silent?: boolean } = {}) {
    const now = Date.now()
    if (lastSdiRefresh && now - lastSdiRefresh < 30_000) {
      if (!opts.silent) toast('Aggiornato di recente, riprova tra qualche secondo')
      return
    }
    setRefreshingAll(true)
    setLastSdiRefresh(now)
    try {
      const res = await authFetch('/.netlify/functions/check-sdi-statuses', { method: 'POST' })
      const json = await res.json()
      if (!opts.silent) {
        if (json.updated > 0) {
          const accepted = (json.transitions || []).filter((t: { to: string }) => t.to === 'accepted').length
          const rejected = (json.transitions || []).filter((t: { to: string }) => t.to === 'rejected').length
          const sent = (json.transitions || []).filter((t: { to: string }) => t.to === 'sent').length
          const parts: string[] = []
          if (accepted) parts.push(`${accepted} accettate`)
          if (rejected) parts.push(`${rejected} scartate`)
          if (sent) parts.push(`${sent} inviate`)
          toast.success(`Stati aggiornati: ${parts.join(', ') || json.updated + ' fatture'}`)
        } else if (json.checked > 0) {
          toast(`Verificate ${json.checked} fatture, nessun cambio di stato.`)
        } else {
          toast('Nessuna fattura in attesa di risposta SDI.')
        }
      }
      await loadInvoices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!opts.silent) toast.error('Errore aggiornamento: ' + msg)
      else console.warn('[FatturaTab] silent SDI refresh failed:', msg)
    } finally {
      setRefreshingAll(false)
    }
  }

  // No auto-refresh: l'utente non vuole che la tab si auto-aggiorni mentre
  // sta lavorando (la lista che si ricarica interrompe il flusso). Il
  // refresh stati SDI è solo manuale via i bottoni "Aggiorna stati SDI" /
  // "Riconcilia con Aruba". Il cron server-side (ogni 30 min) tiene
  // comunque allineato il DB in background.

  // Riconciliazione bulk con Aruba — utile quando il polling è in ritardo
  // e admin vede stati diversi tra dashboard Aruba e admin (es: 29 scartate
  // su Aruba ma admin badge ne mostra 3). Una sola invocazione scarica
  // la lista outgoing da Aruba (paginata) e allinea tutto.
  async function reconcileWithAruba() {
    setReconciling(true)
    try {
      const res = await authFetch('/.netlify/functions/reconcile-sdi-statuses', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error('Riconciliazione fallita: ' + (json.error || 'errore sconosciuto'))
        return
      }
      const accepted = (json.transitions || []).filter((t: { to: string }) => t.to === 'accepted').length
      const rejected = (json.transitions || []).filter((t: { to: string }) => t.to === 'rejected').length
      const sent = (json.transitions || []).filter((t: { to: string }) => t.to === 'sent').length
      const error = (json.transitions || []).filter((t: { to: string }) => t.to === 'error').length
      const parts: string[] = []
      if (accepted) parts.push(`${accepted} accettate`)
      if (rejected) parts.push(`${rejected} scartate`)
      if (error) parts.push(`${error} errore`)
      if (sent) parts.push(`${sent} inviate`)
      toast.success(
        json.updated > 0
          ? `Riconciliazione: ${parts.join(', ')} su ${json.totalRemote} fatture Aruba`
          : `Già allineato: ${json.totalRemote} fatture Aruba verificate`,
        { duration: 6000 }
      )
      await loadInvoices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Errore riconciliazione: ' + msg)
    } finally {
      setReconciling(false)
    }
  }

  // Marca la notifica SDI come "vista" — toglie il badge dalla sidebar e
  // dal sub-tab Fattura senza dover risolvere/reinviare la fattura.
  // Si resetta automaticamente al prossimo passaggio in rejected/scartata/error
  // (gestito server-side in _check-sdi-statuses.ts).
  async function markNotificationSeen(invoice: Invoice) {
    const { error } = await supabase
      .from('fatture')
      .update({ sdi_notification_seen: true })
      .eq('id', invoice.id)
    if (error) {
      toast.error('Errore: ' + error.message)
      return
    }
    setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, sdi_notification_seen: true } : i))
    toast.success('Notifica segnata come vista')
  }

  async function togglePagato(invoice: Invoice) {
    if (!canManagePayments) {
      toast.error('Solo la direzione (o chi ha il ruolo "payment-manager") può modificare lo stato pagamento.')
      return
    }
    const newStato = invoice.stato === 'paid' ? 'pending' : 'paid'
    setUpdatingStato(invoice.id)
    try {
      const { error } = await supabase.from('fatture').update({ stato: newStato }).eq('id', invoice.id)
      if (error) throw error
      setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, stato: newStato } : i))
      toast.success(newStato === 'paid' ? 'Fattura segnata come PAGATA' : 'Fattura segnata come NON PAGATA')
      logAdminAction('fattura_payment_toggle', 'fattura', invoice.id, {
        ...buildFatturaContext(invoice),
        new_stato: newStato,
      })
    } catch (err: any) {
      toast.error(`Errore: ${err.message}`)
    } finally {
      setUpdatingStato(null)
    }
  }

  useEffect(() => {
    loadInvoices()
  }, [])

  async function loadInvoices() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('fatture')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) throw error
      setInvoices(data || [])
    } catch (error) {
      console.error('Failed to load invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  function requireOtpConfirm(label: string): boolean {
    const code = String(Math.floor(1000 + Math.random() * 9000))
    const input = window.prompt(`⚠️ ${label}\n\nDigita il codice ${code} per confermare:`)
    return input === code
  }

  async function handleDelete(id: string) {
    const invoice = invoices.find(i => i.id === id)
    if (!invoice) return

    // Block deletion of fatture already sent to SDI
    if (invoice.sdi_status && ['sending', 'sent', 'accepted'].includes(invoice.sdi_status)) {
      alert(`Impossibile eliminare ${invoice.numero_fattura}: fattura già inviata a SDI (stato: ${invoice.sdi_status}).\n\nSe necessario, crea una Nota di Credito.`)
      return
    }

    if (!requireOtpConfirm(`Eliminare fattura ${invoice.numero_fattura} — ${invoice.customer_name}?`)) return

    try {
      const { error } = await supabase.from('fatture').delete().eq('id', id)
      if (error) throw error
      logAdminAction('delete_fattura', 'fattura', id, buildFatturaContext(invoice))
      loadInvoices()
    } catch (error) {
      console.error('Error deleting invoice:', error)
      alert('Errore durante l\'eliminazione')
    }
  }

  async function handleBulkDelete() {
    // Block if any selected fattura was sent to SDI
    const sentInvoices = invoices.filter(i => selectedIds.includes(i.id) && i.sdi_status && ['sending', 'sent', 'accepted'].includes(i.sdi_status))
    if (sentInvoices.length > 0) {
      alert(`Impossibile eliminare: ${sentInvoices.length} fattura/e già inviate a SDI.\n\n${sentInvoices.map(i => i.numero_fattura).join(', ')}\n\nRimuovile dalla selezione.`)
      return
    }

    if (!requireOtpConfirm(`Eliminare ${selectedIds.length} fatture selezionate?`)) return

    try {
      const { error } = await supabase.from('fatture').delete().in('id', selectedIds)
      if (error) throw error
      setSelectedIds([])
      {
        const deleted = invoices.filter(i => selectedIds.includes(i.id))
        logAdminAction('bulk_delete_fatture', 'fattura', selectedIds.join(','), {
          count: deleted.length,
          fatture: deleted.map(i => i.numero_fattura).join(', '),
          customers: Array.from(new Set(deleted.map(i => i.customer_name).filter(Boolean))).join(', '),
          total: deleted.reduce((sum, i) => sum + (i.importo_totale || 0), 0),
        })
      }
      loadInvoices()
    } catch (error) {
      console.error('Error bulk deleting invoices:', error)
      alert('Errore durante l\'eliminazione multipla')
    }
  }

  async function downloadPDF(invoice: Invoice) {
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <body style="font-family:system-ui,sans-serif;text-align:center;padding:50px;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
            <div>
              <div style="margin-bottom:20px;font-size:30px;">📄</div>
              <div>Generazione anteprima in corso...</div>
            </div>
          </body>
        </html>
      `)
    }

    try {
      const response = await authFetch('/.netlify/functions/generate-invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id })
      })

      if (!response.ok) {
        throw new Error('Failed to generate invoice PDF')
      }

      const html = await response.text()
      loadInvoices()

      if (printWindow) {
        printWindow.document.open()
        printWindow.document.write(html)
        printWindow.document.close()
      } else {
        const blob = new Blob([html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank')
        setTimeout(() => URL.revokeObjectURL(url), 3000)
      }
    } catch (error) {
      console.error('Error downloading PDF:', error)
      if (printWindow) printWindow.close()
      alert('Errore durante la generazione del PDF')
    }
  }

  async function handleCheckStatus(invoiceId: string) {
    setCheckingStatus(invoiceId)
    try {
      const response = await fetch('/.netlify/functions/check-sdi-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId })
      })

      const result = await response.json()

      if (response.ok) {
        alert(`Stato aggiornato: ${result.status}\n\nDettagli: ${JSON.stringify(result.details, null, 2)}`)
        loadInvoices()
      } else {
        alert(`Errore nel controllo stato:\n\n${result.error}`)
      }
    } catch (error) {
      console.error('Error checking status:', error)
      alert('Errore durante il controllo dello stato')
    } finally {
      setCheckingStatus(null)
    }
  }

  async function handleNotaDiCredito(invoice: Invoice) {
    if (!confirm(`Creare Nota di Credito per ${invoice.numero_fattura} (€${(invoice.importo_totale || 0).toFixed(2)})?`)) return
    setCreatingNdc(invoice.id)
    try {
      const response = await authFetch('/.netlify/functions/generate-nota-di-credito', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id })
      })
      const result = await response.json()
      if (!response.ok) {
        alert(`Errore: ${result.error}`)
        return
      }
      alert(`${result.message}`)
      logAdminAction('create_nota_di_credito', 'fattura', invoice.id, buildFatturaContext(invoice))
      loadInvoices()
    } catch (error) {
      console.error('Error creating nota di credito:', error)
      alert('Errore durante la creazione della nota di credito')
    } finally {
      setCreatingNdc(null)
    }
  }

  async function handleSendToSDI(invoice: Invoice) {
    if (!invoice.customer_tax_code) {
      alert('Il Codice Fiscale è obbligatorio per la fatturazione elettronica.')
      return
    }


    try {
      const updatedInvoices = invoices.map(i =>
        i.id === invoice.id ? { ...i, sdi_status: 'sending' as const } : i
      )
      setInvoices(updatedInvoices)

      const response = await fetch('/.netlify/functions/send-invoice-to-sdi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id })
      })

      const result = await response.json()

      if (!response.ok) {
        console.error('SDI send failed:', result.error, result.details)
      } else {
        logAdminAction('send_sdi', 'fattura', invoice.id, buildFatturaContext(invoice))
      }

      loadInvoices()
    } catch (error) {
      console.error('Error sending to SDI:', error)
      loadInvoices()
    }
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento fatture...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-theme-text-primary">Fattura Amministrazione</h2>
            <div className="flex bg-theme-bg-secondary border border-theme-border rounded-full overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setView('emesse')}
                className={`px-4 py-1.5 transition-colors ${view === 'emesse' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
              >
                Emesse
              </button>
              <button
                type="button"
                onClick={() => setView('ricevute')}
                className={`px-4 py-1.5 transition-colors ${view === 'ricevute' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
              >
                Ricevute (Aruba)
              </button>
            </div>
          </div>
          <p className="text-sm text-theme-text-muted">Gestisci tutte le fatture, i pagamenti e lo stato SDI</p>
        </div>
        {view === 'emesse' && (
          <div className="flex gap-2 items-center">
            <button
              onClick={() => refreshAllSdi()}
              disabled={refreshingAll}
              className="px-4 py-2 rounded-full font-medium transition-colors bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 flex items-center gap-2"
              title="Interroga Aruba e aggiorna lo stato SDI di tutte le fatture in attesa"
            >
              {refreshingAll ? 'Aggiornamento…' : 'Aggiorna stati SDI'}
            </button>
            <button
              onClick={() => reconcileWithAruba()}
              disabled={reconciling}
              className="px-4 py-2 rounded-full font-medium transition-colors bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-2"
              title="Scarica lista completa da Aruba e allinea TUTTI gli stati (per recuperare disallineamenti)"
            >
              {reconciling ? 'Riconciliazione…' : 'Riconcilia con Aruba'}
            </button>
            <button
              onClick={() => {
                setMultiSelectMode(!multiSelectMode)
                setSelectedIds([])
              }}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${multiSelectMode
                ? 'bg-blue-600 text-white'
                : 'bg-theme-bg-secondary text-theme-text-muted hover:bg-theme-bg-tertiary'
                }`}
            >
              {multiSelectMode ? 'Annulla Selezione' : 'Selezione Multipla'}
            </button>

            {multiSelectMode && selectedIds.length > 0 && (
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-full font-medium transition-colors"
              >
                × Selezionati ({selectedIds.length})
              </button>
            )}
          </div>
        )}
      </div>

      {view === 'ricevute' && <IncomingInvoicesView />}
      {view === 'emesse' && (
      <>
      {hasRole('direzione') && <InvoiceFooterEditor />}
      {/* ─── KPI strip ──────────────────────────────────────────────── */}
      {/* 6 cards dei dati chiave del mese (Fatturato Emesso, Incassato,
          Da Incassare, % Incasso, In Scadenza, Pagamenti Programmati). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard
          icon="up"
          label="Fatturato Emesso"
          value={formatEur(kpis.emesso)}
          delta={kpis.emessoDeltaPct}
          deltaSuffix="vs mese scorso"
          tone="primary"
        />
        <KpiCard
          icon="check"
          label="Fatturato Incassato"
          value={formatEur(kpis.incassato)}
          delta={kpis.incassatoDeltaPct}
          deltaSuffix="vs mese scorso"
          tone="success"
        />
        <KpiCard
          icon="hourglass"
          label="Da Incassare"
          value={formatEur(kpis.daIncassare)}
          tone="warning"
        />
        <KpiCard
          icon="percent"
          label="% Incasso"
          value={`${kpis.incassoPct.toFixed(1)}%`}
          delta={kpis.incassoPctDeltaPct}
          deltaIsPp
          deltaSuffix="vs mese scorso"
          tone="info"
        />
        <KpiCard
          icon="clock"
          label="Fatture in Scadenza"
          value={String(kpis.inScadenza)}
          deltaSuffix="prossimi 7 giorni"
          tone="alert"
        />
        <KpiCard
          icon="calendar"
          label="Pagamenti Programmati"
          value={String(kpis.pagamentiProgrammati)}
          deltaSuffix="entro fine mese"
          tone="muted"
        />
      </div>

      {/* ─── Two-column layout: main (search + table) | sidebar ──── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">

      <div className="xl:col-span-9 space-y-4 min-w-0">

      {/* Search Bar */}
      <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border space-y-3">
        <input
          type="text"
          placeholder="Cerca per cliente, numero fattura o email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-4 py-2 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold transition-colors"
        />
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col">
            <label className="text-[10px] text-theme-text-muted uppercase tracking-wider mb-1">Cliente</label>
            <select
              value={filterCliente}
              onChange={e => setFilterCliente(e.target.value)}
              className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm min-w-[180px]"
            >
              <option value="all">Tutti i clienti</option>
              {clientiOptions.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-theme-text-muted uppercase tracking-wider mb-1">Stato SDI</label>
            <select
              value={filterSdi}
              onChange={e => setFilterSdi(e.target.value as typeof filterSdi)}
              className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm"
            >
              <option value="all">Tutti</option>
              <option value="rejected">Scartata</option>
              <option value="accepted">Accettata SDI</option>
              <option value="sent">Inviata SDI</option>
              <option value="sending">Invio…</option>
              <option value="error">Errore SDI</option>
              <option value="draft">Bozza</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-theme-text-muted uppercase tracking-wider mb-1">Tipo</label>
            <select
              value={filterTipo}
              onChange={e => setFilterTipo(e.target.value as typeof filterTipo)}
              className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm"
            >
              <option value="all">Tutti</option>
              <option value="fattura">Solo Fatture</option>
              <option value="nota_credito">Solo Note Credito</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-theme-text-muted uppercase tracking-wider mb-1">Da</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
              className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-theme-text-muted uppercase tracking-wider mb-1">A</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
              className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm"
            />
          </div>
          {(filterSdi !== 'all' || filterTipo !== 'all' || filterCliente !== 'all' || filterDateFrom || filterDateTo || searchQuery) && (
            <button
              onClick={() => {
                setFilterSdi('all'); setFilterTipo('all'); setFilterCliente('all'); setFilterDateFrom(''); setFilterDateTo(''); setSearchQuery('')
              }}
              className="px-3 py-2 rounded text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-border"
            >
              Pulisci filtri
            </button>
          )}
        </div>
      </div>

      {/* Invoices Table */}
      {invoices.length === 0 ? (
        <div className="bg-theme-bg-secondary rounded-lg p-12 text-center">
          <p className="text-theme-text-muted text-lg mb-4">Nessuna fattura trovata</p>
          <p className="text-theme-text-muted text-sm">Le fatture vengono generate automaticamente dalle prenotazioni</p>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="bg-theme-bg-secondary rounded-lg p-12 text-center border border-theme-border">
          <p className="text-theme-text-muted text-sm">Nessuna fattura corrisponde ai filtri attuali.</p>
        </div>
      ) : (
        <div className="bg-theme-bg-secondary rounded-xl border border-theme-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-bg-tertiary/50 text-theme-text-muted text-[11px] uppercase tracking-wider">
                <tr>
                  {multiSelectMode && <th className="px-3 py-3 w-10"></th>}
                  <th className="px-4 py-3 text-left font-medium">Numero Fattura</th>
                  <th className="px-4 py-3 text-left font-medium">Cliente</th>
                  <th className="px-4 py-3 text-left font-medium">Data</th>
                  <th className="px-4 py-3 text-left font-medium">Tipo</th>
                  <th className="px-4 py-3 text-right font-medium">Totale</th>
                  <th className="px-4 py-3 text-left font-medium">Stato Pagamento</th>
                  <th className="px-4 py-3 text-left font-medium">Stato SDI</th>
                  <th className="px-4 py-3 text-left font-medium">Scadenza</th>
                  <th className="px-3 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-border">
                {pagedInvoices.map(invoice => {
                  const isNotaCredito = invoice.tipo_fattura === 'nota_credito' || invoice.tipo_fattura === 'TD04' || invoice.tipo_fattura === 'nota_di_credito'
                  const overdue = isInvoiceOverdue(invoice)
                  const due = getInvoiceDueDate(invoice)
                  const dueLabel = due ? due.toLocaleDateString('it-IT') : '—'
                  const sdiStatus = invoice.sdi_status || (isNotaCredito ? null : 'draft')
                  const sdiLabel = !sdiStatus ? '—'
                    : sdiStatus === 'accepted' ? 'Accettata'
                    : sdiStatus === 'sent' ? 'Inviata'
                    : sdiStatus === 'sending' ? 'Invio…'
                    : sdiStatus === 'rejected' || sdiStatus === 'scartata' ? 'Scartata'
                    : sdiStatus === 'error' ? 'Errore'
                    : 'Bozza'
                  const sdiClass = !sdiStatus ? 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                    : sdiStatus === 'accepted' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : sdiStatus === 'sent' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                    : sdiStatus === 'sending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : sdiStatus === 'rejected' || sdiStatus === 'scartata' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    : sdiStatus === 'error' ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                    : 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                  const statoLabel = invoice.stato === 'paid' ? 'Pagata' : invoice.stato === 'cancelled' ? 'Annullata' : overdue ? 'Scaduta' : 'In attesa'
                  const statoClass = invoice.stato === 'paid' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : invoice.stato === 'cancelled' ? 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                    : overdue ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  const open = openActionsId === invoice.id
                  return (
                    <tr key={invoice.id} className="hover:bg-theme-bg-tertiary/30 transition-colors">
                      {multiSelectMode && (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(invoice.id)}
                            onChange={() => toggleSelect(invoice.id)}
                            className="rounded border-theme-border bg-theme-bg-tertiary text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-theme-text-primary whitespace-nowrap">{invoice.numero_fattura}</td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <div className="text-theme-text-primary font-medium truncate" title={invoice.customer_name}>{invoice.customer_name}</div>
                        {invoice.customer_email && (
                          <div className="text-[11px] text-theme-text-muted truncate">{invoice.customer_email}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-theme-text-secondary whitespace-nowrap">{new Date(invoice.data_emissione).toLocaleDateString('it-IT')}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${isNotaCredito ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-blue-500/10 text-blue-400 border-blue-500/30'}`}>
                          {isNotaCredito ? 'N. Credito' : 'Fattura'}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold ${isNotaCredito ? 'text-rose-400' : 'text-dr7-gold'}`}>
                        {isNotaCredito ? '−' : ''}{formatEur(Math.abs(Number(invoice.importo_totale) || 0))}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statoClass}`}>
                          {statoLabel}
                        </span>
                        {overdue && invoice.stato !== 'paid' && (
                          <div className="text-[10px] text-rose-400 mt-0.5">⚠ {daysOverdue(invoice)}g di ritardo</div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${sdiClass}`}>
                          {sdiLabel}
                        </span>
                        {invoice.sdi_status && ['rejected', 'scartata'].includes(invoice.sdi_status) && !invoice.sdi_notification_seen && (
                          <button
                            type="button"
                            onClick={() => markNotificationSeen(invoice)}
                            className="ml-1 text-[10px] text-theme-text-muted underline hover:text-theme-text-primary"
                            title="Segna notifica come vista"
                          >
                            vista
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-theme-text-secondary whitespace-nowrap">{dueLabel}</td>
                      <td className="px-3 py-3 text-right relative">
                        <button
                          type="button"
                          onClick={() => setOpenActionsId(open ? null : invoice.id)}
                          className="w-8 h-8 rounded-full hover:bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary inline-flex items-center justify-center"
                          aria-label="Azioni"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                          </svg>
                        </button>
                        {open && (
                          <>
                            <div className="fixed inset-0 z-30" onClick={() => setOpenActionsId(null)} />
                            <div className="absolute right-2 top-10 z-40 w-48 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl overflow-hidden text-left">
                              <button onClick={() => { downloadPDF(invoice); setOpenActionsId(null) }} className="w-full px-3 py-2 text-xs text-theme-text-primary hover:bg-theme-bg-tertiary flex items-center gap-2">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} strokeLinecap="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" /></svg>
                                Scarica PDF
                              </button>
                              {(!invoice.sdi_status || invoice.sdi_status === 'draft' || invoice.sdi_status === 'error' || invoice.sdi_status === 'rejected' || invoice.sdi_status === 'scartata') ? (
                                <button onClick={() => { handleSendToSDI(invoice); setOpenActionsId(null) }} className="w-full px-3 py-2 text-xs text-theme-text-primary hover:bg-theme-bg-tertiary flex items-center gap-2">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} strokeLinecap="round" d="M3 11l18-8-8 18-2-7-8-3z" /></svg>
                                  {invoice.sdi_status === 'rejected' || invoice.sdi_status === 'scartata' ? 'Reinvia a SDI' : 'Invia a SDI'}
                                </button>
                              ) : (
                                <>
                                  <button onClick={() => { handleCheckStatus(invoice.id); setOpenActionsId(null) }} disabled={checkingStatus === invoice.id} className="w-full px-3 py-2 text-xs text-theme-text-primary hover:bg-theme-bg-tertiary flex items-center gap-2 disabled:opacity-50">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeWidth={2} strokeLinecap="round" d="M12 7v5l3 2" /></svg>
                                    {checkingStatus === invoice.id ? 'Controllo…' : 'Verifica stato SDI'}
                                  </button>
                                  <button onClick={() => { handleSendToSDI(invoice); setOpenActionsId(null) }} className="w-full px-3 py-2 text-xs text-theme-text-primary hover:bg-theme-bg-tertiary flex items-center gap-2">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} strokeLinecap="round" d="M3 11l18-8-8 18-2-7-8-3z" /></svg>
                                    Reinvia a SDI
                                  </button>
                                </>
                              )}
                              {canManagePayments && (
                                <button onClick={() => { togglePagato(invoice); setOpenActionsId(null) }} disabled={updatingStato === invoice.id} className="w-full px-3 py-2 text-xs text-theme-text-primary hover:bg-theme-bg-tertiary flex items-center gap-2 disabled:opacity-50">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>
                                  {invoice.stato === 'paid' ? 'Segna NON pagata' : 'Segna PAGATA'}
                                </button>
                              )}
                              {!isNotaCredito && (
                                <button onClick={() => { handleNotaDiCredito(invoice); setOpenActionsId(null) }} disabled={creatingNdc === invoice.id} className="w-full px-3 py-2 text-xs text-amber-400 hover:bg-theme-bg-tertiary flex items-center gap-2 disabled:opacity-50">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} strokeLinecap="round" d="M9 14l-4-4 4-4M5 10h11a4 4 0 014 4v6" /></svg>
                                  {creatingNdc === invoice.id ? 'Creazione…' : 'Crea Nota di Credito'}
                                </button>
                              )}
                              <button onClick={() => { handleDelete(invoice.id); setOpenActionsId(null) }} className="w-full px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 border-t border-theme-border">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} strokeLinecap="round" d="M19 7l-1 13a2 2 0 01-2 2H8a2 2 0 01-2-2L5 7m5 4v6m4-6v6M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" /></svg>
                                Elimina
                              </button>
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
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
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="text-theme-text-muted">risultati</span>
            </div>
            <div className="text-theme-text-muted">
              {filteredInvoices.length === 0
                ? '0'
                : `${safePage * pageSize + 1} - ${Math.min((safePage + 1) * pageSize, filteredInvoices.length)} di ${filteredInvoices.length} fatture`}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(0)}
                disabled={safePage === 0}
                className="px-2 py-1 rounded border border-theme-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed"
                title="Prima pagina"
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
                  >
                    {i + 1}
                  </button>
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
                title="Ultima pagina"
              >»</button>
            </div>
          </div>
        </div>
      )}

      </div>{/* /main column */}

      {/* ─── Sidebar destra ──────────────────────────────────────── */}
      <aside className="xl:col-span-3 space-y-4 min-w-0">
        {/* Riepilogo Finanziario */}
        <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-theme-text-primary">Riepilogo Finanziario</h3>
            <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">Mese</span>
          </div>
          {(() => {
            const now = new Date()
            const startMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            let pagate = 0, daIncassare = 0, inRitardo = 0
            for (const i of invoices) {
              if (i.tipo_fattura === 'nota_credito') continue
              const issued = i.data_emissione ? new Date(i.data_emissione) : null
              if (!issued || issued < startMonth) continue
              const total = Number(i.importo_totale) || 0
              if (i.stato === 'paid') pagate += total
              else if (i.stato === 'cancelled') continue
              else if (isInvoiceOverdue(i)) inRitardo += total
              else daIncassare += total
            }
            const totale = pagate + daIncassare + inRitardo
            const pct = (n: number) => totale > 0 ? Math.round((n / totale) * 100) : 0
            return (
              <>
                <div className="text-2xl font-bold text-theme-text-primary tabular-nums">{formatEur(totale)}</div>
                <div className="text-[11px] text-theme-text-muted mb-3">Totale fatturato del mese</div>
                <div className="flex h-2 rounded-full overflow-hidden bg-theme-bg-tertiary mb-3">
                  <div className="bg-emerald-500" style={{ width: `${pct(pagate)}%` }} />
                  <div className="bg-amber-500" style={{ width: `${pct(daIncassare)}%` }} />
                  <div className="bg-rose-500" style={{ width: `${pct(inRitardo)}%` }} />
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" />Pagate</span><span className="tabular-nums text-theme-text-primary">{formatEur(pagate)} <span className="text-theme-text-muted">({pct(pagate)}%)</span></span></div>
                  <div className="flex justify-between"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500" />Da incassare</span><span className="tabular-nums text-theme-text-primary">{formatEur(daIncassare)} <span className="text-theme-text-muted">({pct(daIncassare)}%)</span></span></div>
                  <div className="flex justify-between"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-rose-500" />In ritardo</span><span className="tabular-nums text-theme-text-primary">{formatEur(inRitardo)} <span className="text-theme-text-muted">({pct(inRitardo)}%)</span></span></div>
                </div>
              </>
            )
          })()}
        </div>

        {/* Scadenze a breve */}
        <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-theme-text-primary">Scadenze a breve</h3>
            <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">7 giorni</span>
          </div>
          {(() => {
            const now = new Date()
            const in7 = new Date(now.getTime() + 7 * 86400000)
            const upcoming = invoices
              .filter(i => i.stato !== 'paid' && i.stato !== 'cancelled' && i.tipo_fattura !== 'nota_credito')
              .map(i => ({ inv: i, due: getInvoiceDueDate(i) }))
              .filter(x => x.due && x.due >= now && x.due <= in7)
              .sort((a, b) => (a.due!.getTime() - b.due!.getTime()))
              .slice(0, 5)
            if (upcoming.length === 0) {
              return <p className="text-xs text-theme-text-muted italic">Nessuna scadenza nei prossimi 7 giorni.</p>
            }
            return (
              <ul className="space-y-2">
                {upcoming.map(({ inv, due }) => {
                  const daysLeft = Math.max(0, Math.ceil((due!.getTime() - now.getTime()) / 86400000))
                  return (
                    <li key={inv.id} className="flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-theme-text-primary truncate">{inv.customer_name || '—'}</p>
                        <p className="text-theme-text-muted text-[11px]">{inv.numero_fattura}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="tabular-nums text-theme-text-primary">{formatEur(Number(inv.importo_totale) || 0)}</p>
                        <p className={`text-[11px] ${daysLeft <= 2 ? 'text-rose-400' : 'text-amber-400'}`}>
                          {daysLeft === 0 ? 'oggi' : daysLeft === 1 ? 'domani' : `tra ${daysLeft}g`}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )
          })()}
        </div>

        {/* Rimborsi (Note di Credito recenti) */}
        <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-theme-text-primary">Rimborsi</h3>
            <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">Note di credito</span>
          </div>
          {(() => {
            const ndc = invoices
              .filter(i => i.tipo_fattura === 'nota_credito')
              .sort((a, b) => (new Date(b.data_emissione).getTime() - new Date(a.data_emissione).getTime()))
              .slice(0, 4)
            if (ndc.length === 0) {
              return <p className="text-xs text-theme-text-muted italic">Nessuna nota di credito emessa.</p>
            }
            return (
              <ul className="space-y-2">
                {ndc.map(i => (
                  <li key={i.id} className="flex items-start justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-theme-text-primary truncate">{i.customer_name || '—'}</p>
                      <p className="text-theme-text-muted text-[11px]">{i.numero_fattura} · {new Date(i.data_emissione).toLocaleDateString('it-IT')}</p>
                    </div>
                    <p className="tabular-nums text-rose-400 shrink-0">−{formatEur(Math.abs(Number(i.importo_totale) || 0))}</p>
                  </li>
                ))}
              </ul>
            )
          })()}
        </div>

        {/* Azioni Rapide */}
        <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Azioni Rapide</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button onClick={() => refreshAllSdi()} disabled={refreshingAll} className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg px-3 py-2 text-left disabled:opacity-50">
              <div className="font-semibold">Aggiorna SDI</div>
              <div className="text-[10px] text-theme-text-muted">Stati Aruba</div>
            </button>
            <button onClick={() => reconcileWithAruba()} disabled={reconciling} className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg px-3 py-2 text-left disabled:opacity-50">
              <div className="font-semibold">Riconcilia</div>
              <div className="text-[10px] text-theme-text-muted">Allinea Aruba</div>
            </button>
            <button onClick={() => setFilterSdi('rejected')} className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg px-3 py-2 text-left">
              <div className="font-semibold">Filtra Scartate</div>
              <div className="text-[10px] text-theme-text-muted">Stato SDI</div>
            </button>
            <button onClick={() => setFilterTipo('nota_credito')} className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg px-3 py-2 text-left">
              <div className="font-semibold">Note di Credito</div>
              <div className="text-[10px] text-theme-text-muted">Solo NdC</div>
            </button>
            <button onClick={() => { setFilterSdi('all'); setFilterTipo('all'); setFilterCliente('all'); setFilterDateFrom(''); setFilterDateTo(''); setSearchQuery('') }} className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg px-3 py-2 text-left col-span-2">
              <div className="font-semibold">Reset filtri</div>
              <div className="text-[10px] text-theme-text-muted">Mostra tutte</div>
            </button>
          </div>
        </div>

        {/* Report Veloci */}
        <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Report Veloci</h3>
          <ul className="text-xs space-y-1.5">
            <li><button onClick={() => setFilterSdi('rejected')} className="text-blue-400 hover:underline">Fatture scartate da SDI</button></li>
            <li><button onClick={() => { setSearchQuery(''); setFilterCliente('all'); setFilterTipo('all'); setFilterSdi('all') }} className="text-blue-400 hover:underline">Tutte le fatture</button></li>
            <li><button onClick={() => setFilterTipo('nota_credito')} className="text-blue-400 hover:underline">Solo Note di Credito</button></li>
            <li><button onClick={() => setFilterTipo('fattura')} className="text-blue-400 hover:underline">Solo Fatture</button></li>
          </ul>
        </div>
      </aside>

      </div>{/* /two-column grid */}

      {/* ─── Bottom: 3 grafici ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FatturaTrendChart invoices={invoices} />
        <TopClientiChart invoices={invoices} />
        <AnalisiIncassiChart invoices={invoices} />
      </div>
      </>
      )}
    </div>
  )
}

// Badge counter — SOLO fatture scartate da SDI (rejected/scartata) E non
// ancora dismissate dall'admin via bottone "Vista". Errori di pipeline
// ('error') sono esclusi: non sono scarti SDI veri, sono fallimenti
// upload/network che si risolvono col Reinvia.
// Polling ogni 60s + realtime sul cambio sdi_status.
// eslint-disable-next-line react-refresh/only-export-components
export function useFatturaScartataCount() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { count: n } = await supabase
        .from('fatture')
        .select('id', { count: 'exact', head: true })
        .in('sdi_status', ['rejected', 'scartata'])
        .eq('sdi_notification_seen', false)
      if (!cancelled && typeof n === 'number') setCount(n)
    }
    load()
    const id = setInterval(load, 60_000)
    const channel = supabase
      .channel('fattura-scartata-count')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fatture' }, load)
      .subscribe()
    return () => {
      cancelled = true
      clearInterval(id)
      supabase.removeChannel(channel)
    }
  }, [])

  return count
}

// ─── InvoiceFooterEditor ─────────────────────────────────────────────────
// Direzione edits the 3 footer lines printed on every invoice PDF.
// Writes centralina_pro_config.config.invoice.footer_lines; read by
// netlify/functions/invoice-pdf-utils.ts on each PDF render.
function InvoiceFooterEditor() {
  const DEFAULT_LINES = [
    'Dubai rent 7.0 S.p.A. - Iscr. reg. imp.: 04104640927',
    'Tel: 3457905205 | Email: Info@dr7.app | PEC: dubai.rent7.0srl@legalmail.it | Website: www.dr7empire.com',
    'Socio unico - Cap. soc. 50.000,00 € | Regime Fiscale: Ordinario',
  ]
  const [lines, setLines] = useState<string[]>(DEFAULT_LINES)
  const [saved, setSaved] = useState<string[]>(DEFAULT_LINES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      if (cancelled) return
      const cfg = (data?.config || {}) as Record<string, unknown>
      const inv = (cfg.invoice || {}) as Record<string, unknown>
      const arr = inv.footer_lines
      if (Array.isArray(arr) && arr.length > 0) {
        const next = arr.map(String)
        setLines(next)
        setSaved(next)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const dirty = JSON.stringify(lines) !== JSON.stringify(saved)

  const handleSave = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const { data: existing } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (existing?.config || {}) as Record<string, unknown>
      const inv = (cfg.invoice || {}) as Record<string, unknown>
      const nextInv = { ...inv, footer_lines: lines.filter(s => s.trim().length > 0) }
      const nextCfg = { ...cfg, invoice: nextInv }
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: nextCfg }, { onConflict: 'id' })
      if (error) throw error
      setSaved(lines)
      toast.success('Footer fattura salvato')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Errore sconosciuto'
      toast.error(`Errore salvataggio: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => setLines(DEFAULT_LINES)

  return (
    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-dr7-gold/15 text-dr7-gold flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-theme-text-primary">Footer fattura</h3>
            <p className="text-[12px] text-theme-text-muted">3 righe legali/contatti stampate in fondo a ogni PDF fattura.</p>
          </div>
        </div>
        <span className="text-[11px] text-theme-text-muted">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={line}
                onChange={e => setLines(prev => prev.map((l, idx) => idx === i ? e.target.value : l))}
                placeholder={DEFAULT_LINES[i] || `Riga ${i + 1}`}
                disabled={loading}
                className="flex-1 bg-theme-bg-primary border border-theme-border rounded-md px-3 py-2 text-[12px] font-mono"
              />
              <button
                type="button"
                onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
                className="px-2 text-red-500 hover:bg-red-500/10 rounded-md text-sm"
                title="Rimuovi riga"
              >×</button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines(prev => [...prev, ''])}
            className="w-full py-2 rounded-md border-2 border-dashed border-theme-border text-[12px] text-theme-text-secondary hover:bg-theme-bg-primary"
          >+ Aggiungi riga</button>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving || loading}
              className="px-3 py-1.5 text-[12px] text-theme-text-secondary hover:underline disabled:opacity-40"
            >Ripristina default</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving || loading}
              className="px-4 py-1.5 rounded-md bg-dr7-gold text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >{saving ? 'Salvataggio…' : 'Salva'}</button>
          </div>
          <p className="text-[11px] text-theme-text-muted">
            Le modifiche valgono per le fatture generate da ora in avanti. I PDF già emessi restano invariati.
          </p>
        </div>
      )}
    </div>
  )
}
