import { useState, useMemo } from 'react'

interface CustomerReport {
  customerId: string
  name: string
  email: string
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
  totale_giorni: number
  totale_prenotazioni: number
  totale_spesa: number
}

interface CustomerReportData {
  totalCustomers: number
  customers: CustomerReport[]
}

type SortField = keyof Omit<CustomerReport, 'customerId' | 'name' | 'email'>

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
  const [sortField, setSortField] = useState<SortField>('totale_spesa')
  const [sortAsc, setSortAsc] = useState(false)

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
    } catch (err: any) {
      setError(err.message || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  const filteredClienti = useMemo(() => {
    if (!clientiData?.customers) return []
    if (!search.trim()) return clientiData.customers
    const q = search.trim().toLowerCase()
    return clientiData.customers.filter(c =>
      (c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
    )
  }, [clientiData, search])

  const sortedClienti = useMemo(() =>
    [...filteredClienti].sort((a, b) => sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField]),
    [filteredClienti, sortField, sortAsc]
  )

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



  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-theme-text-primary">Report Clienti</h2>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
        <button
          onClick={fetchClienti}
          disabled={loading}
          className="px-6 py-2 bg-dr7-gold text-black font-semibold rounded-full hover:bg-yellow-500 transition-colors disabled:opacity-50"
        >
          {loading ? 'Caricamento...' : 'Genera Report'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {clientiData && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Clienti Totali</p>
              <p className="text-2xl font-bold text-theme-text-primary">{clientiData.totalCustomers}</p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Spesa Totale</p>
              <p className="text-2xl font-bold text-dr7-gold">
                {formatCurrency(clientiData.customers.reduce((s, c) => s + c.totale_spesa, 0))}
              </p>
            </div>
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
              <p className="text-xs text-theme-text-muted">Prenotazioni Totali</p>
              <p className="text-2xl font-bold text-theme-text-primary">
                {clientiData.customers.reduce((s, c) => s + c.totale_prenotazioni, 0)}
              </p>
            </div>
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
                  {sortedClienti.map((c, i) => (
                    <tr key={c.customerId || i} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30 transition-colors">
                      {/* Sticky Cliente column */}
                      <td
                        className="px-3 py-2 sticky left-0 z-10 bg-theme-bg-secondary/95 backdrop-blur-sm"
                        style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.15)' }}
                      >
                        <div className="font-medium text-theme-text-primary text-sm leading-tight">{c.name}</div>
                        <div className="text-[11px] text-theme-text-muted leading-tight truncate max-w-[200px]">{c.email !== '-' ? c.email : ''}</div>
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
              {sortedClienti.map((c, i) => (
                <div key={c.customerId || i} className="bg-theme-bg-tertiary/30 rounded-lg p-4 border border-theme-border">
                  {/* Name + Email */}
                  <div className="mb-3">
                    <p className="font-semibold text-theme-text-primary text-sm">{c.name}</p>
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
          </div>

          {sortedClienti.length === 0 && (
            <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
              <p className="text-theme-text-muted">Nessun cliente trovato.</p>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!clientiData && !loading && !error && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-theme-text-muted text-lg mb-2">Clicca "Genera Report" per visualizzare i dati</p>
          <p className="text-theme-text-muted text-sm">Il report include noleggi, lavaggi, meccanica, penali e danni per cliente</p>
        </div>
      )}
    </div>
  )
}
