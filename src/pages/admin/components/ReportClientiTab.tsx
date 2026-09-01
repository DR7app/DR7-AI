import { useState, useMemo, useEffect } from 'react'
import { ReportCard, ReportTable, ReportRow, ReportTotalRow, ReportEmpty } from './ReportUI'
import ReportClienteModal from './ReportClienteModal'
import ClientStatusBadge from '../../../components/ClientStatusBadge'
import type { ClientTier } from '../../../contexts/ClientStatusContext'
import DateRangePicker, { resolveDateRange, isInRange, type DateRangeValue } from '../../../components/admin/DateRangePicker'
import toast from 'react-hot-toast'
// #38 Modifica manuale report: correggi/rimuovi/aggiungi voci; gli override
// (report_overrides) si applicano PRIMA dei totali.
import { loadReportOverrides, applyOverrides, saveEditOverride, saveRemoveOverride, saveAddOverride, deleteOverrideByRow, deleteOverrideById, type LoadedOverrides } from '../../../utils/reportOverrides'
import { ReportRowModal, type FieldDef } from './ReportRowModal'

interface CustomerReport {
  customerId: string
  name: string
  email: string
  phone?: string
  tipo_cliente?: string | null
  status_cliente?: ClientTier | null
  dr7_club?: boolean
  wallet_balance: number
  wallet_recharges_12m: number
  supercar_spesa: number
  supercar_prenotazioni: number
  supercar_giorni: number
  urban_spesa: number
  urban_prenotazioni: number
  urban_giorni: number
  aziendali_spesa: number
  aziendali_prenotazioni: number
  aziendali_giorni: number
  lavaggi_spesa: number
  lavaggi_prenotazioni: number
  meccanica_spesa: number
  meccanica_prenotazioni: number
  penali_spesa: number
  penali_eventi: number
  danni_spesa: number
  danni_eventi: number
  annullate_count: number
  cauzioni_attive_count: number
  cauzioni_attive: number
  prima_prenotazione: string | null
  ultima_prenotazione: string | null
  totale_giorni: number
  totale_prenotazioni: number
  totale_spesa: number
}

interface CustomerReportData {
  totalCustomers: number
  customers: CustomerReport[]
}

type SortField = keyof Omit<
  CustomerReport,
  'customerId' | 'name' | 'email' | 'phone' | 'tipo_cliente' | 'status_cliente' | 'dr7_club' | 'prima_prenotazione' | 'ultima_prenotazione'
>

function formatCurrency(amount: number): string {
  return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function cellVal(v: number, type: 'eur' | 'int'): string {
  if (v === 0) return '-'
  return type === 'eur' ? formatCurrency(v) : String(v)
}

// Column configuration to avoid JSX repetition
interface ColumnDef {
  key: keyof CustomerReport
  label: string
  type: 'eur' | 'int'
}

interface ColumnGroup {
  label: string
  bg?: string // tailwind bg for header tint
  cellBg?: string // tailwind bg for data cells
  border?: boolean // left border separator
  columns: ColumnDef[]
}

const COLUMN_GROUPS: ColumnGroup[] = [
  {
    label: 'Supercar',
    border: true,
    columns: [
      { key: 'supercar_spesa', label: 'Spesa', type: 'eur' },
      { key: 'supercar_prenotazioni', label: 'Pren.', type: 'int' },
      { key: 'supercar_giorni', label: 'Giorni', type: 'int' },
    ],
  },
  {
    label: 'Urban',
    border: true,
    columns: [
      { key: 'urban_spesa', label: 'Spesa', type: 'eur' },
      { key: 'urban_prenotazioni', label: 'Pren.', type: 'int' },
      { key: 'urban_giorni', label: 'Giorni', type: 'int' },
    ],
  },
  {
    label: 'Aziendali',
    border: true,
    columns: [
      { key: 'aziendali_spesa', label: 'Spesa', type: 'eur' },
      { key: 'aziendali_prenotazioni', label: 'Pren.', type: 'int' },
      { key: 'aziendali_giorni', label: 'Giorni', type: 'int' },
    ],
  },
  {
    label: 'Lavaggi',
    border: true,
    columns: [
      { key: 'lavaggi_spesa', label: 'Spesa', type: 'eur' },
      { key: 'lavaggi_prenotazioni', label: 'Pren.', type: 'int' },
    ],
  },
  {
    label: 'Meccanica',
    border: true,
    columns: [
      { key: 'meccanica_spesa', label: 'Spesa', type: 'eur' },
      { key: 'meccanica_prenotazioni', label: 'Pren.', type: 'int' },
    ],
  },
  {
    label: 'Penali',
    border: true,
    bg: 'bg-orange-500/5',
    cellBg: 'bg-orange-500/5',
    columns: [
      { key: 'penali_spesa', label: 'Spesa', type: 'eur' },
      { key: 'penali_eventi', label: 'Eventi', type: 'int' },
    ],
  },
  {
    label: 'Danni',
    border: true,
    bg: 'bg-red-500/5',
    cellBg: 'bg-red-500/5',
    columns: [
      { key: 'danni_spesa', label: 'Spesa', type: 'eur' },
      { key: 'danni_eventi', label: 'Eventi', type: 'int' },
    ],
  },
  {
    label: 'Annullate',
    border: true,
    bg: 'bg-zinc-500/5',
    cellBg: 'bg-zinc-500/5',
    columns: [
      { key: 'annullate_count', label: 'Pren.', type: 'int' },
    ],
  },
  {
    label: 'Wallet',
    border: true,
    bg: 'bg-emerald-500/5',
    cellBg: 'bg-emerald-500/5',
    columns: [
      { key: 'wallet_balance', label: 'Saldo', type: 'eur' },
      { key: 'wallet_recharges_12m', label: 'Ric. 12m', type: 'eur' },
    ],
  },
  {
    label: 'Cauzioni',
    border: true,
    bg: 'bg-purple-500/5',
    cellBg: 'bg-purple-500/5',
    columns: [
      { key: 'cauzioni_attive', label: 'Bloccate', type: 'eur' },
      { key: 'cauzioni_attive_count', label: 'N°', type: 'int' },
    ],
  },
  {
    label: 'Totale',
    border: true,
    bg: 'bg-yellow-500/5',
    cellBg: 'bg-yellow-500/5',
    columns: [
      { key: 'totale_spesa', label: 'Spesa', type: 'eur' },
      { key: 'totale_prenotazioni', label: 'Pren.', type: 'int' },
      { key: 'totale_giorni', label: 'Giorni', type: 'int' },
    ],
  },
]

// Palette categoriale verificata (sei controlli, chiaro e scuro): l'ordine e'
// fisso, ogni servizio tiene sempre il suo colore anche se un altro sparisce.
const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'totale_spesa', label: 'Spesa Totale' },
  { value: 'totale_prenotazioni', label: 'Prenotazioni Totali' },
  { value: 'totale_giorni', label: 'Giorni Totali' },
  { value: 'supercar_spesa', label: 'Supercar' },
  { value: 'urban_spesa', label: 'Urban' },
  { value: 'aziendali_spesa', label: 'Aziendali' },
  { value: 'danni_spesa', label: 'Danni' },
  { value: 'penali_spesa', label: 'Penali' },
]

export default function ReportClientiTab() {
  const [clientiData, setClientiData] = useState<CustomerReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<DateRangeValue>({ preset: 'all' })
  const [sortField, setSortField] = useState<SortField>('totale_spesa')
  const [sortAsc, setSortAsc] = useState(false)
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null)
  // 29/08/2026 — la tabella montava TUTTE le righe, e in piu' le card mobile,
  // che restano nel DOM anche da desktop (`md:hidden` nasconde, non smonta):
  // con 2.100 clienti erano oltre centomila nodi disegnati all'apertura e
  // ridisegnati a ogni ricerca o riordino, e la tab sembrava bloccata. Ora si
  // disegna una pagina per volta; totali, classifiche, grafici e riepiloghi
  // restano calcolati su TUTTI i clienti filtrati, non sulla pagina.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // #38 Modifica manuale report
  const [overrides, setOverrides] = useState<LoadedOverrides>({ raw: [], removed: new Set(), edits: new Map(), added: [], notesByRow: new Map() })
  const [editReport, setEditReport] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editRow, setEditRow] = useState<any | null>(null)
  const [addMode, setAddMode] = useState(false)
  const EDIT_FIELDS: FieldDef[] = [
    { key: 'totale_spesa', label: 'Spesa €' },
    { key: 'totale_prenotazioni', label: 'Prenotazioni' },
    { key: 'penali_spesa', label: 'Penali €' },
    { key: 'danni_spesa', label: 'Danni €' },
  ]
  async function reloadOv() { setOverrides(await loadReportOverrides('clienti')) }
  async function saveEdit(changes: Record<string, number>, note: string) {
    if (!editRow) return
    for (const [field, value] of Object.entries(changes)) await saveEditOverride('clienti', editRow.customerId, field, value, note)
    setEditRow(null); await reloadOv(); toast.success('Voce corretta')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function saveAdd(row: any, note: string) {
    await saveAddOverride('clienti', { ...row, customerId: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }, note)
    setAddMode(false); await reloadOv(); toast.success('Voce aggiunta')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function removeRow(c: any) {
    if (!window.confirm(`Rimuovere ${c.name || 'questo cliente'} dal report?`)) return
    if (c._isManual) await deleteOverrideById(c._manualId); else await saveRemoveOverride('clienti', c.customerId, null)
    await reloadOv(); toast.success('Voce rimossa')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function restoreRow(c: any) {
    if (c._isManual) await deleteOverrideById(c._manualId); else await deleteOverrideByRow('clienti', c.customerId)
    await reloadOv(); toast.success('Voce ripristinata')
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  function sortArrow(field: string) {
    if (sortField !== field) return ''
    return sortAsc ? ' \u2191' : ' \u2193'
  }

  async function fetchClienti() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/.netlify/functions/report-clienti')
      const data = await res.json()
      if (!res.ok) throw new Error(data.details || data.error || 'Errore nel caricamento')
      setClientiData(data)
      setOverrides(await loadReportOverrides('clienti'))
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      setError(_errMsg || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  // Il report si carica da solo all'apertura della tab: niente pulsante
  // "Genera Report" da premere ogni volta.
  useEffect(() => {
    fetchClienti()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const range = useMemo(() => resolveDateRange(dateRange), [dateRange])

  const filteredClienti = useMemo(() => {
    if (!clientiData?.customers) return []
    const q = search.trim().toLowerCase()
    return clientiData.customers.filter(c => {
      // 2026-05-28: filtro per data ultima prenotazione (cliente "attivo
      // nel periodo"). Clienti senza prenotazioni passano sempre quando
      // preset='all', altrimenti vengono esclusi dal range temporale.
      if (range.from || range.to) {
        if (!isInRange(c.ultima_prenotazione, range)) return false
      }
      if (q && !((c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))) {
        return false
      }
      return true
    })
  }, [clientiData, search, range])

  // #38: applica gli override PRIMA di ordinare/totalizzare.
  const adjustedClienti = useMemo(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyOverrides(filteredClienti as any, overrides, (c: any) => c.customerId) as CustomerReport[],
    [filteredClienti, overrides])

  const sortedClienti = useMemo(() =>
    [...adjustedClienti].sort((a, b) => sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField]),
    [adjustedClienti, sortField, sortAsc]
  )

  const totalPages = Math.max(1, Math.ceil(sortedClienti.length / pageSize))
  const pageCorrente = Math.min(page, totalPages)
  const pageClienti = useMemo(
    () => sortedClienti.slice((pageCorrente - 1) * pageSize, pageCorrente * pageSize),
    [sortedClienti, pageCorrente, pageSize]
  )
  // Cambiare ricerca, periodo, ordinamento o dimensione pagina riporta in testa.
  useEffect(() => { setPage(1) }, [search, dateRange, sortField, sortAsc, pageSize])
  // Numeri di pagina a finestra: con 2.100 clienti le pagine sono decine, non
  // si stampano tutte.
  const pageNumbers = useMemo(() => {
    const intorno = 2
    const start = Math.max(1, Math.min(pageCorrente - intorno, totalPages - intorno * 2))
    const end = Math.min(totalPages, start + intorno * 2)
    const out: number[] = []
    for (let i = start; i <= end; i++) out.push(i)
    return out
  }, [pageCorrente, totalPages])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const removedClienti = useMemo(() =>
    (clientiData?.customers || []).filter((c: any) => overrides.removed.has(c.customerId)),
    [clientiData, overrides])

  // Compute footer totals from filtered data
  const footerTotals = useMemo(() => {
    const t: Record<string, number> = {}
    const allKeys = COLUMN_GROUPS.flatMap(g => g.columns.map(c => c.key))
    allKeys.forEach(k => { t[k] = 0 })
    sortedClienti.forEach(c => {
      allKeys.forEach(k => { t[k] += (c[k] as number) || 0 })
    })
    return t
  }, [sortedClienti])

  // Classifica: chi ha speso di piu' e chi pesa in negativo
  // (danni + penali + prenotazioni annullate).
  const topSpenders = useMemo(
    () => [...adjustedClienti].filter(c => c.totale_spesa > 0).sort((a, b) => b.totale_spesa - a.totale_spesa).slice(0, 10),
    [adjustedClienti]
  )
  const spesaTotaleFiltrata = useMemo(
    () => adjustedClienti.reduce((s, c) => s + c.totale_spesa, 0),
    [adjustedClienti]
  )
  const negativi = useMemo(
    () => adjustedClienti
      .map(c => ({ c, negativo: c.danni_spesa + c.penali_spesa }))
      .filter(x => x.negativo > 0 || x.c.annullate_count > 0)
      .sort((a, b) => (b.negativo - a.negativo) || (b.c.annullate_count - a.c.annullate_count))
      .slice(0, 10),
    [adjustedClienti]
  )
  // Grafici: ripartizione della spesa per servizio e acquisizione clienti.
  const serviceMix = useMemo(() => {
    const rows = [
      { name: 'Supercar', value: adjustedClienti.reduce((s, c) => s + c.supercar_spesa, 0) },
      { name: 'Urban', value: adjustedClienti.reduce((s, c) => s + c.urban_spesa, 0) },
      { name: 'Aziendali', value: adjustedClienti.reduce((s, c) => s + c.aziendali_spesa, 0) },
      { name: 'Lavaggi', value: adjustedClienti.reduce((s, c) => s + c.lavaggi_spesa, 0) },
      { name: 'Meccanica', value: adjustedClienti.reduce((s, c) => s + c.meccanica_spesa, 0) },
    ]
    return rows.filter(r => r.value > 0)
  }, [adjustedClienti])

  const nuoviClienti = useMemo(() => {
    const mesi: { key: string; label: string; clienti: number }[] = []
    const now = new Date()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      mesi.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('it-IT', { month: 'short' }),
        clienti: 0,
      })
    }
    const idx = new Map(mesi.map((m, i) => [m.key, i]))
    adjustedClienti.forEach(c => {
      if (!c.prima_prenotazione) return
      const d = new Date(c.prima_prenotazione)
      if (Number.isNaN(d.getTime())) return
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const i = idx.get(k)
      if (i !== undefined) mesi[i].clienti += 1
    })
    return mesi
  }, [adjustedClienti])

  const rankByCustomer = useMemo(() => {
    const m = new Map<string, number>()
    ;[...adjustedClienti].sort((a, b) => b.totale_spesa - a.totale_spesa)
      .forEach((c, i) => { if (c.customerId) m.set(c.customerId, i + 1) })
    return m
  }, [adjustedClienti])



  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-theme-text-primary">Report Clienti</h2>
          <button
            onClick={fetchClienti}
            disabled={loading}
            title="Ricarica il report"
            aria-label="Ricarica il report"
            className="w-8 h-8 rounded-full border border-theme-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors flex items-center justify-center disabled:opacity-40"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {loading && (
        <div className="text-sm text-theme-text-muted">Caricamento report...</div>
      )}

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {clientiData && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted uppercase tracking-wider">Clienti</p>
              <p className="text-2xl font-bold text-theme-text-primary">{adjustedClienti.length}</p>
              <p className="text-[11px] text-theme-text-muted">su {clientiData.totalCustomers} totali</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted uppercase tracking-wider">Spesa Totale</p>
              <p className="text-2xl font-bold text-dr7-gold">{formatCurrency(spesaTotaleFiltrata)}</p>
              <p className="text-[11px] text-theme-text-muted">
                media {formatCurrency(adjustedClienti.length ? spesaTotaleFiltrata / adjustedClienti.length : 0)}
              </p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted uppercase tracking-wider">Prenotazioni</p>
              <p className="text-2xl font-bold text-theme-text-primary">
                {adjustedClienti.reduce((s, c) => s + c.totale_prenotazioni, 0)}
              </p>
              <p className="text-[11px] text-theme-text-muted">
                {adjustedClienti.reduce((s, c) => s + c.annullate_count, 0)} annullate
              </p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted uppercase tracking-wider">Miglior Cliente</p>
              {topSpenders[0] ? (
                <>
                  <p className="text-base font-bold text-theme-text-primary truncate">{topSpenders[0].name}</p>
                  <p className="text-lg font-bold text-dr7-gold leading-tight">{formatCurrency(topSpenders[0].totale_spesa)}</p>
                </>
              ) : (
                <p className="text-2xl font-bold text-theme-text-muted">-</p>
              )}
            </div>
          </div>

          {/* Classifiche: Top spesa + Negativo
              2026-08-27 (richiesta direzione): stessa forma del Report Terra —
              tabelle, non barre colorate ne' grafici. */}
          {(topSpenders.length > 0 || negativi.length > 0) && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <ReportCard title="Top Clienti — Spesa" right={`primi ${topSpenders.length}`}>
                {topSpenders.length === 0 ? (
                  <ReportEmpty message="Nessun cliente nel periodo." />
                ) : (
                  <ReportTable
                    head={
                      <>
                        <th className="text-left px-4 py-3">#</th>
                        <th className="text-left px-4 py-3">Cliente</th>
                        <th className="text-center px-4 py-3">Pren.</th>
                        <th className="text-center px-4 py-3">Giorni</th>
                        <th className="text-right px-4 py-3">Spesa</th>
                        <th className="text-right px-4 py-3">Quota</th>
                      </>
                    }
                  >
                    {topSpenders.map((c, i) => {
                      const quota = spesaTotaleFiltrata > 0 ? (c.totale_spesa / spesaTotaleFiltrata) * 100 : 0
                      return (
                        <ReportRow key={c.customerId || i} onClick={() => c.customerId && setOpenCustomerId(c.customerId)}>
                          <td className="px-4 py-3 tabular-nums text-theme-text-muted">{i + 1}</td>
                          <td className="px-4 py-3">
                            <span className="block font-medium text-theme-text-primary">{c.name}</span>
                            {c.email !== '-' && <span className="block text-xs text-theme-text-muted">{c.email}</span>}
                          </td>
                          <td className="px-4 py-3 text-center tabular-nums text-theme-text-primary">{c.totale_prenotazioni}</td>
                          <td className="px-4 py-3 text-center tabular-nums text-theme-text-primary">{c.totale_giorni}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-dr7-gold">{formatCurrency(c.totale_spesa)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-theme-text-muted">{quota.toFixed(1)}%</td>
                        </ReportRow>
                      )
                    })}
                  </ReportTable>
                )}
              </ReportCard>

              <ReportCard title="Negativo — Danni, Penali, Annullate" right={`primi ${negativi.length}`}>
                {negativi.length === 0 ? (
                  <ReportEmpty message="Nessun cliente con danni, penali o annullate." />
                ) : (
                  <ReportTable
                    head={
                      <>
                        <th className="text-left px-4 py-3">#</th>
                        <th className="text-left px-4 py-3">Cliente</th>
                        <th className="text-center px-4 py-3">Danni</th>
                        <th className="text-center px-4 py-3">Penali</th>
                        <th className="text-center px-4 py-3">Annullate</th>
                        <th className="text-right px-4 py-3">Negativo</th>
                        <th className="text-right px-4 py-3">Spesa</th>
                      </>
                    }
                  >
                    {negativi.map(({ c, negativo }, i) => (
                      <ReportRow key={c.customerId || i} onClick={() => c.customerId && setOpenCustomerId(c.customerId)}>
                        <td className="px-4 py-3 tabular-nums text-theme-text-muted">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-theme-text-primary">{c.name}</td>
                        <td className="px-4 py-3 text-center tabular-nums text-theme-text-primary">{c.danni_eventi || '-'}</td>
                        <td className="px-4 py-3 text-center tabular-nums text-theme-text-primary">{c.penali_eventi || '-'}</td>
                        <td className="px-4 py-3 text-center tabular-nums text-theme-text-primary">{c.annullate_count || '-'}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-red-500">{negativo > 0 ? `− ${formatCurrency(negativo)}` : '-'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-theme-text-muted">{formatCurrency(c.totale_spesa)}</td>
                      </ReportRow>
                    ))}
                  </ReportTable>
                )}
              </ReportCard>
            </div>
          )}

          {/* Ripartizioni: tabelle, non grafici */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ReportCard title="Spesa per Servizio" right={`Totale ${formatCurrency(spesaTotaleFiltrata)}`}>
              {serviceMix.length === 0 ? (
                <ReportEmpty message="Nessuna spesa nel periodo" />
              ) : (
                <ReportTable
                  head={
                    <>
                      <th className="text-left px-4 py-3">Servizio</th>
                      <th className="text-right px-4 py-3">Spesa</th>
                      <th className="text-right px-4 py-3">% del Totale</th>
                    </>
                  }
                  foot={
                    <ReportTotalRow>
                      <td className="px-4 py-3">Totale</td>
                      <td className="px-4 py-3 text-right tabular-nums text-dr7-gold">{formatCurrency(spesaTotaleFiltrata)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">100%</td>
                    </ReportTotalRow>
                  }
                >
                  {serviceMix.map(r => (
                    <ReportRow key={r.name}>
                      <td className="px-4 py-3 font-medium text-theme-text-primary">{r.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-theme-text-primary">{formatCurrency(r.value)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-theme-text-muted">
                        {spesaTotaleFiltrata > 0 ? `${((r.value / spesaTotaleFiltrata) * 100).toFixed(1)}%` : '-'}
                      </td>
                    </ReportRow>
                  ))}
                </ReportTable>
              )}
            </ReportCard>

            <ReportCard title="Nuovi Clienti" right="prima prenotazione — ultimi 12 mesi">
              {nuoviClienti.length === 0 ? (
                <ReportEmpty message="Nessun nuovo cliente" />
              ) : (
                <ReportTable
                  head={
                    <>
                      <th className="text-left px-4 py-3">Mese</th>
                      <th className="text-right px-4 py-3">Nuovi Clienti</th>
                    </>
                  }
                  foot={
                    <ReportTotalRow>
                      <td className="px-4 py-3">Totale</td>
                      <td className="px-4 py-3 text-right tabular-nums">{nuoviClienti.reduce((t, m) => t + m.clienti, 0)}</td>
                    </ReportTotalRow>
                  }
                >
                  {nuoviClienti.map(m => (
                    <ReportRow key={m.label}>
                      <td className="px-4 py-3 font-medium text-theme-text-primary">{m.label}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-theme-text-primary">{m.clienti}</td>
                    </ReportRow>
                  ))}
                </ReportTable>
              )}
            </ReportCard>
          </div>


          {/* Search + Sort */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <input
              type="text"
              placeholder="Cerca per nome o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-4 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-sm placeholder-theme-text-muted w-full max-w-xs"
            />
            <div className="flex items-center gap-2">
              <button onClick={() => setEditReport(v => !v)} title="Correggi/rimuovi/aggiungi voci a mano" className={`px-3 py-2 text-xs font-medium rounded border ${editReport ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-theme-bg-tertiary border-theme-border-light text-theme-text-secondary'}`}>{editReport ? '✓ Modifica report' : '✎ Modifica report'}</button>
              {editReport && <button onClick={() => setAddMode(true)} className="px-3 py-2 text-xs font-medium rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">+ Voce</button>}
              <label className="text-xs text-theme-text-muted">Ordina per:</label>
              <select
                value={sortField}
                onChange={(e) => { setSortField(e.target.value as SortField); setSortAsc(false) }}
                className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={() => setSortAsc(!sortAsc)}
                className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm hover:bg-theme-bg-hover transition-colors"
                title={sortAsc ? 'Crescente' : 'Decrescente'}
              >
                {sortAsc ? '\u2191' : '\u2193'}
              </button>
            </div>
            {search && (
              <span className="text-xs text-theme-text-muted">
                {filteredClienti.length} di {clientiData.totalCustomers} clienti
              </span>
            )}
          </div>

          {/* Desktop Table */}
          <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="text-sm" style={{ minWidth: '1400px' }}>
                {/* 2-level grouped header */}
                <thead>
                  {/* Row 1: Group names */}
                  <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                    <th
                      rowSpan={2}
                      className="text-left px-3 py-2 sticky left-0 z-20 bg-theme-bg-primary backdrop-blur-sm"
                      style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.3)' }}
                    >
                      Cliente
                    </th>
                    {COLUMN_GROUPS.map(g => (
                      <th
                        key={g.label}
                        colSpan={g.columns.length}
                        className={`text-center px-1 py-2 text-xs font-semibold uppercase tracking-wider ${g.border ? 'border-l border-theme-border/50' : ''} ${g.bg || ''}`}
                      >
                        {g.label}
                      </th>
                    ))}
                  </tr>
                  {/* Row 2: Sub-column labels (clickable for sort) */}
                  <tr className="bg-theme-bg-primary/30 text-theme-text-muted text-[11px]">
                    {COLUMN_GROUPS.map((g, gi) =>
                      g.columns.map((col, ci) => (
                        <th
                          key={col.key}
                          onClick={() => handleSort(col.key as SortField)}
                          className={`px-2 py-1 cursor-pointer select-none hover:text-theme-text-primary transition-colors whitespace-nowrap ${col.type === 'eur' ? 'text-right' : 'text-center'} ${gi > 0 && ci === 0 ? 'border-l border-theme-border/50' : ''} ${g.bg || ''} ${sortField === col.key ? 'text-dr7-gold font-semibold' : ''}`}
                        >
                          {col.label}{sortArrow(col.key)}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pageClienti.map((c, i) => (
                    <tr key={c.customerId || i} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                      {/* Sticky Cliente column */}
                      <td
                        className="px-3 py-2 sticky left-0 z-10 bg-theme-bg-secondary/95 backdrop-blur-sm"
                        style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.15)' }}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="w-5 h-5 shrink-0 rounded-full bg-theme-bg-tertiary text-[10px] font-bold text-theme-text-muted flex items-center justify-center" title="Posizione per spesa totale">
                            {rankByCustomer.get(c.customerId) ?? '-'}
                          </span>
                          <button
                            type="button"
                            onClick={() => c.customerId && setOpenCustomerId(c.customerId)}
                            className="font-medium text-theme-text-primary text-sm leading-tight hover:text-dr7-gold transition-colors text-left"
                            title="Apri report cliente"
                          >
                            {c.name}
                          </button>
                          <ClientStatusBadge
                            tier={c.status_cliente ?? undefined}
                            dr7Club={c.dr7_club}
                            customerId={c.customerId}
                            email={c.email !== '-' ? c.email : undefined}
                            phone={c.phone !== '-' ? c.phone : undefined}
                          />
                        </div>
                        <div className="text-[11px] text-theme-text-muted leading-tight truncate max-w-[220px]">
                          {c.email !== '-' ? c.email : ''}
                          {c.phone && c.phone !== '-' ? ` · ${c.phone}` : ''}
                        </div>
                        {c.ultima_prenotazione && (
                          <div className="text-[10px] text-theme-text-muted/70 leading-tight">
                            Ultima: {new Date(c.ultima_prenotazione).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                          </div>
                        )}
                        {editReport && (
                          <div className="flex items-center gap-1 mt-1">
                            <button onClick={() => setEditRow(c)} className="text-[10px] px-1.5 py-0.5 rounded bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary">Modifica</button>
                            <button onClick={() => removeRow(c)} className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 text-red-400">Rimuovi</button>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {((c as any)._overrideNote && !(c as any)._isManual) && <button onClick={() => restoreRow(c)} className="text-[10px] px-1.5 py-0.5 rounded border border-theme-border text-theme-text-muted">Ripristina</button>}
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(c as any)._overrideNote && <span className="text-[11px] text-amber-400" title={(c as any)._overrideNote}>✎</span>}
                          </div>
                        )}
                      </td>
                      {COLUMN_GROUPS.map((g, gi) =>
                        g.columns.map((col, ci) => {
                          const val = c[col.key] as number
                          const isEur = col.type === 'eur'
                          // Special text colors
                          let textColor = 'text-theme-text-primary'
                          if (isEur && val > 0) {
                            if (col.key === 'danni_spesa') textColor = 'text-red-400'
                            else if (col.key === 'penali_spesa') textColor = 'text-orange-400'
                            else if (col.key === 'totale_spesa') textColor = 'text-dr7-gold font-semibold'
                            else textColor = 'text-theme-text-primary'
                          }
                          return (
                            <td
                              key={col.key}
                              className={`px-2 py-2 ${isEur ? 'text-right' : 'text-center'} ${gi > 0 && ci === 0 ? 'border-l border-theme-border/30' : ''} ${g.cellBg || ''} ${textColor}`}
                            >
                              {cellVal(val, col.type)}
                            </td>
                          )
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
                {/* Footer totals */}
                <tfoot>
                  <tr className="border-t-2 border-dr7-gold/30 bg-theme-bg-primary/30">
                    <td
                      className="px-3 py-3 font-bold text-theme-text-primary sticky left-0 z-10 bg-theme-bg-primary/95 backdrop-blur-sm"
                      style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.15)' }}
                    >
                      Totale ({sortedClienti.length})
                    </td>
                    {COLUMN_GROUPS.map((g, gi) =>
                      g.columns.map((col, ci) => {
                        const val = Math.round((footerTotals[col.key] || 0) * 100) / 100
                        const isEur = col.type === 'eur'
                        let textColor = 'text-theme-text-primary font-bold'
                        if (col.key === 'danni_spesa') textColor = 'text-red-400 font-bold'
                        else if (col.key === 'penali_spesa') textColor = 'text-orange-400 font-bold'
                        else if (col.key === 'totale_spesa') textColor = 'text-dr7-gold font-bold'
                        return (
                          <td
                            key={col.key}
                            className={`px-2 py-3 ${isEur ? 'text-right' : 'text-center'} ${gi > 0 && ci === 0 ? 'border-l border-theme-border/30' : ''} ${g.cellBg || ''} ${textColor}`}
                          >
                            {cellVal(val, col.type)}
                          </td>
                        )
                      })
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden p-3 space-y-3">
              {pageClienti.map((c, i) => (
                <div key={c.customerId || i} className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border">
                  {/* Name + Email */}
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={() => c.customerId && setOpenCustomerId(c.customerId)}
                      className="font-semibold text-theme-text-primary text-sm text-left hover:text-dr7-gold transition-colors"
                    >
                      #{rankByCustomer.get(c.customerId) ?? '-'} · {c.name}
                    </button>
                    {c.email !== '-' && <p className="text-xs text-theme-text-muted">{c.email}</p>}
                  </div>

                  {/* Noleggi section */}
                  <div className="mb-2">
                    <p className="text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider mb-1">Noleggi</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {[
                        { label: 'Supercar', spesa: c.supercar_spesa, pren: c.supercar_prenotazioni, giorni: c.supercar_giorni },
                        { label: 'Urban', spesa: c.urban_spesa, pren: c.urban_prenotazioni, giorni: c.urban_giorni },
                        { label: 'Aziendali', spesa: c.aziendali_spesa, pren: c.aziendali_prenotazioni, giorni: c.aziendali_giorni },
                      ].map(cat => (
                        <div key={cat.label}>
                          <p className="text-[10px] text-theme-text-muted">{cat.label}</p>
                          <p className="text-xs font-medium text-theme-text-primary">
                            {cat.spesa > 0 ? formatCurrency(cat.spesa) : '-'}
                          </p>
                          <p className="text-[10px] text-theme-text-muted">
                            {cat.pren > 0 ? `${cat.pren} pren.` : ''}{cat.pren > 0 && cat.giorni > 0 ? ' / ' : ''}{cat.giorni > 0 ? `${cat.giorni}g` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Servizi section */}
                  <div className="mb-2">
                    <p className="text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider mb-1">Servizi</p>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div>
                        <p className="text-[10px] text-theme-text-muted">Lavaggi</p>
                        <p className="text-xs font-medium text-theme-text-primary">
                          {c.lavaggi_spesa > 0 ? formatCurrency(c.lavaggi_spesa) : '-'}
                        </p>
                        {c.lavaggi_prenotazioni > 0 && <p className="text-[10px] text-theme-text-muted">{c.lavaggi_prenotazioni} pren.</p>}
                      </div>
                      <div>
                        <p className="text-[10px] text-theme-text-muted">Meccanica</p>
                        <p className="text-xs font-medium text-theme-text-primary">
                          {c.meccanica_spesa > 0 ? formatCurrency(c.meccanica_spesa) : '-'}
                        </p>
                        {c.meccanica_prenotazioni > 0 && <p className="text-[10px] text-theme-text-muted">{c.meccanica_prenotazioni} pren.</p>}
                      </div>
                    </div>
                  </div>

                  {/* Penali / Danni */}
                  {(c.penali_spesa > 0 || c.danni_spesa > 0) && (
                    <div className="mb-2">
                      <div className="grid grid-cols-2 gap-2 text-center">
                        {c.penali_spesa > 0 && (
                          <div className="bg-orange-500/10 rounded px-2 py-1">
                            <p className="text-[10px] text-orange-400">Penali</p>
                            <p className="text-xs font-medium text-orange-400">{formatCurrency(c.penali_spesa)}</p>
                            <p className="text-[10px] text-theme-text-muted">{c.penali_eventi} eventi</p>
                          </div>
                        )}
                        {c.danni_spesa > 0 && (
                          <div className="bg-red-500/10 rounded px-2 py-1">
                            <p className="text-[10px] text-red-400">Danni</p>
                            <p className="text-xs font-medium text-red-400">{formatCurrency(c.danni_spesa)}</p>
                            <p className="text-[10px] text-theme-text-muted">{c.danni_eventi} eventi</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Totale */}
                  <div className="border-t border-theme-border pt-2 mt-2 flex justify-between items-center">
                    <span className="text-xs font-bold text-theme-text-muted uppercase">Totale</span>
                    <div className="text-right">
                      <span className="text-base font-bold text-dr7-gold">{formatCurrency(c.totale_spesa)}</span>
                      <span className="text-[10px] text-theme-text-muted ml-2">
                        {c.totale_prenotazioni} pren. / {c.totale_giorni}g
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-theme-border flex flex-wrap items-center justify-between gap-3 text-xs text-theme-text-secondary">
                <span>
                  Mostra {(pageCorrente - 1) * pageSize + 1}-{Math.min(pageCorrente * pageSize, sortedClienti.length)} di {sortedClienti.length} clienti
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(1)} disabled={pageCorrente === 1} className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary disabled:opacity-40 hover:bg-theme-bg-hover" title="Prima pagina">{'\u00AB'}</button>
                  <button onClick={() => setPage(pageCorrente - 1)} disabled={pageCorrente === 1} className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary disabled:opacity-40 hover:bg-theme-bg-hover" title="Pagina precedente">{'\u2039'}</button>
                  {pageNumbers.map(n => (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      className={`w-7 h-7 rounded text-xs font-medium ${pageCorrente === n ? 'bg-dr7-gold text-white' : 'border border-theme-border bg-theme-bg-primary hover:bg-theme-bg-hover'}`}
                    >
                      {n}
                    </button>
                  ))}
                  <button onClick={() => setPage(pageCorrente + 1)} disabled={pageCorrente === totalPages} className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary disabled:opacity-40 hover:bg-theme-bg-hover" title="Pagina successiva">{'\u203A'}</button>
                  <button onClick={() => setPage(totalPages)} disabled={pageCorrente === totalPages} className="px-2 py-1 rounded border border-theme-border bg-theme-bg-primary disabled:opacity-40 hover:bg-theme-bg-hover" title="Ultima pagina">{'\u00BB'}</button>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="ml-2 px-2 py-1 bg-theme-bg-primary border border-theme-border rounded text-theme-text-primary"
                    title="Clienti per pagina"
                  >
                    {[25, 50, 100, 200].map(n => (
                      <option key={n} value={n}>{n} per pagina</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {sortedClienti.length === 0 && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
              <p className="text-theme-text-muted">Nessun cliente trovato.</p>
            </div>
          )}
        </div>
      )}

      {openCustomerId && (
        <ReportClienteModal customerId={openCustomerId} onClose={() => setOpenCustomerId(null)} />
      )}

      {/* Empty state */}
      {!clientiData && !loading && !error && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-theme-text-muted text-lg mb-2">Nessun dato da mostrare</p>
          <p className="text-theme-text-muted text-sm">Il report include noleggi, lavaggi, meccanica, penali e danni per cliente</p>
        </div>
      )}

      {editReport && removedClienti.length > 0 && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <div className="text-[11px] text-theme-text-muted mb-1">Clienti rimossi ({removedClienti.length}) — ripristinabili</div>
          <div className="flex flex-col gap-1">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {removedClienti.map((c: any) => (
              <div key={c.customerId} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-theme-bg-tertiary/30 text-theme-text-muted">
                <span className="truncate line-through">{c.name} · {formatCurrency(c.totale_spesa || 0)}</span>
                <button onClick={() => restoreRow(c)} className="ml-2 text-[11px] px-1.5 py-0.5 rounded border border-theme-border text-theme-text-secondary">Ripristina</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(editRow || addMode) && (
        <ReportRowModal
          mode={addMode ? 'add' : 'edit'}
          row={editRow}
          fields={EDIT_FIELDS}
          identityFields={addMode ? [{ key: 'name', label: 'Nome cliente', required: true }] : []}
          addTemplate={{ name: '', email: '-', phone: '-', totale_giorni: 0, totale_prenotazioni: 0, totale_spesa: 0, penali_spesa: 0, danni_spesa: 0, penali_eventi: 0, danni_eventi: 0, annullate_count: 0, cauzioni_attive_count: 0, cauzioni_attive: 0, status_cliente: 'standard', dr7_club: false, prima_prenotazione: null, ultima_prenotazione: null }}
          onClose={() => { setEditRow(null); setAddMode(false) }}
          onSaveEdit={saveEdit}
          onSaveAdd={saveAdd}
        />
      )}
    </div>
  )
}
