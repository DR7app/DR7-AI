import { Fragment, useMemo, useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import { formatAdminLog, formatEntityLabel } from '../../../utils/formatAdminLog'

interface Admin {
  id: string
  email: string
  nome: string | null
  role: string
}

interface LogEntry {
  id: string
  admin_id: string
  admin_email: string
  admin_name: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: Record<string, any>
  created_at: string
}

const ACTION_LABELS: Record<string, string> = {
  login: 'Login',
  create_booking: 'Creazione prenotazione',
  edit_booking: 'Modifica prenotazione',
  delete_booking: 'Eliminazione prenotazione',
  generate_contract: 'Generazione contratto',
  generate_fattura: 'Generazione fattura',
  extend_booking: 'Estensione prenotazione',
  mark_paid: 'Segna pagato',
  create_penalty: 'Creazione penale',
  create_danni: 'Creazione danno',
  create_carwash: 'Creazione lavaggio',
  delete_carwash: 'Eliminazione lavaggio',
  generate_carwash_fattura: 'Fattura lavaggio',
  create_mechanical: 'Creazione meccanica',
  delete_mechanical: 'Eliminazione meccanica',
  generate_mechanical_fattura: 'Fattura meccanica',
  edit_customer: 'Modifica cliente',
  delete_customer: 'Eliminazione cliente',
  update_customer_status: 'Aggiornamento stato cliente',
  delete_fattura: 'Eliminazione fattura',
  send_sdi: 'Invio SDI',
  send_trustera_document: 'Invio documento Trustera',
  delete_trustera_document: 'Eliminazione documento Trustera',
  mark_extension_paid: 'Segna estensione pagata',
  mark_booking_extensions_paid: 'Segna prenotazione+estensioni pagata',
  mark_all_customer_paid: 'Segna tutto cliente pagato',
  mark_fattura_item_paid: 'Segna voce fattura pagata',
  mark_type_paid: 'Segna tipo pagato',
  partial_payment: 'Pagamento parziale',
  delete_extension: 'Eliminazione estensione',
  delete_unpaid_booking: 'Eliminazione prenotazione non pagata',
}

const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))

const ROME_TZ = 'Europe/Rome'

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('it-IT', { timeZone: ROME_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('it-IT', { timeZone: ROME_TZ, day: '2-digit', month: 'short' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })
}

function dayKey(iso: string): string {
  // YYYY-MM-DD in Rome timezone
  const d = new Date(iso)
  return d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}

function initials(name: string | null, email: string): string {
  const src = (name || email.split('@')[0] || '').trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

function avatarColor(seed: string): string {
  // Deterministic green/gold palette so cards aren't all the same colour
  const palette = ['bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-sky-100 text-sky-700', 'bg-rose-100 text-rose-700', 'bg-violet-100 text-violet-700', 'bg-teal-100 text-teal-700']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function classifyAction(action: string): 'prenotazioni' | 'contratti' | 'fatture' | 'pagamenti' | 'clienti' | 'lavaggi' | 'meccanica' | 'login' | 'altri' {
  if (action === 'login') return 'login'
  if (action.includes('booking') || action.includes('extension')) return 'prenotazioni'
  if (action.includes('contract') || action.includes('trustera')) return 'contratti'
  if (action.includes('fattura') || action.includes('sdi')) return 'fatture'
  if (action.includes('paid') || action.includes('payment')) return 'pagamenti'
  if (action.includes('customer')) return 'clienti'
  if (action.includes('carwash')) return 'lavaggi'
  if (action.includes('mechanical')) return 'meccanica'
  return 'altri'
}

const KPI_CATEGORIES: Array<{ key: ReturnType<typeof classifyAction>; label: string; emoji: string }> = [
  { key: 'prenotazioni', label: 'Prenotazioni', emoji: '🚗' },
  { key: 'contratti', label: 'Contratti', emoji: '📄' },
  { key: 'fatture', label: 'Fatture', emoji: '🧾' },
  { key: 'pagamenti', label: 'Pagamenti', emoji: '💶' },
  { key: 'clienti', label: 'Clienti', emoji: '👤' },
  { key: 'lavaggi', label: 'Lavaggi', emoji: '🧽' },
  { key: 'meccanica', label: 'Meccanica', emoji: '🔧' },
  { key: 'login', label: 'Accessi', emoji: '🔑' },
]

function startOfMonthISO(d: Date): string {
  const year = d.toLocaleDateString('en-CA', { timeZone: ROME_TZ, year: 'numeric' })
  const month = d.toLocaleDateString('en-CA', { timeZone: ROME_TZ, month: '2-digit' })
  return `${year}-${month}-01`
}

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}

export default function OperatoriTab() {
  const [admins, setAdmins] = useState<Admin[]>([])
  const [selectedAdmin, setSelectedAdmin] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [logsLoading, setLogsLoading] = useState(false)
  const [dateFrom, setDateFrom] = useState(startOfMonthISO(new Date()))
  const [dateTo, setDateTo] = useState(todayISO())
  const [actionFilter, setActionFilter] = useState('')
  const [page, setPage] = useState(0)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const PAGE_SIZE = 50

  useEffect(() => {
    loadAdmins()
  }, [])

  useEffect(() => {
    if (selectedAdmin) {
      setPage(0)
      loadLogs(selectedAdmin, 0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdmin, dateFrom, dateTo, actionFilter])

  async function loadAdmins() {
    setLoading(true)
    const ADMIN_ORDER = ['Valerio', 'Ilenia', 'Salvatore', 'Ophélie', 'Davide']
    const { data } = await supabase.from('admins').select('id, email, nome, role')
    if (data) {
      data.sort((a, b) => {
        const ai = ADMIN_ORDER.indexOf(a.nome || '')
        const bi = ADMIN_ORDER.indexOf(b.nome || '')
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      })
      setAdmins(data)
      if (!selectedAdmin && data.length > 0) setSelectedAdmin(data[0].id)
    }
    setLoading(false)
  }

  async function loadLogs(adminId: string, pageNum: number) {
    setLogsLoading(true)
    let query = supabase
      .from('admin_activity_log')
      .select('*')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false })
      .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)

    if (dateFrom) query = query.gte('created_at', new Date(dateFrom).toISOString())
    if (dateTo) {
      const endOfDay = new Date(dateTo)
      endOfDay.setHours(23, 59, 59, 999)
      query = query.lte('created_at', endOfDay.toISOString())
    }
    if (actionFilter) query = query.eq('action', actionFilter)

    const { data } = await query
    setLogs(data || [])
    setLogsLoading(false)
  }

  function handlePageChange(newPage: number) {
    setPage(newPage)
    if (selectedAdmin) loadLogs(selectedAdmin, newPage)
  }

  function setPeriodPreset(preset: 'oggi' | 'mese' | '7gg' | '30gg') {
    const today = new Date()
    const t = todayISO()
    if (preset === 'oggi') { setDateFrom(t); setDateTo(t); return }
    if (preset === 'mese') { setDateFrom(startOfMonthISO(today)); setDateTo(t); return }
    if (preset === '7gg') {
      const d = new Date(); d.setDate(d.getDate() - 6)
      setDateFrom(d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })); setDateTo(t); return
    }
    if (preset === '30gg') {
      const d = new Date(); d.setDate(d.getDate() - 29)
      setDateFrom(d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })); setDateTo(t); return
    }
  }

  const selected = admins.find(a => a.id === selectedAdmin) || null

  // ─── Aggregations from current page logs ─────────────────────────────────
  const stats = useMemo(() => {
    const byDay = new Map<string, { first: string; last: string; count: number }>()
    const byCategory = new Map<string, number>()

    for (const log of logs) {
      const k = dayKey(log.created_at)
      const cur = byDay.get(k)
      if (!cur) byDay.set(k, { first: log.created_at, last: log.created_at, count: 1 })
      else {
        if (log.created_at < cur.first) cur.first = log.created_at
        if (log.created_at > cur.last) cur.last = log.created_at
        cur.count += 1
      }
      const cat = classifyAction(log.action)
      byCategory.set(cat, (byCategory.get(cat) || 0) + 1)
    }

    const days = Array.from(byDay.entries())
      .map(([day, v]) => {
        const ms = new Date(v.last).getTime() - new Date(v.first).getTime()
        const hours = Math.min(12, Math.max(0, ms / 3_600_000))
        return { day, first: v.first, last: v.last, count: v.count, hours }
      })
      .sort((a, b) => b.day.localeCompare(a.day))

    const totalHours = days.reduce((s, d) => s + d.hours, 0)
    const totalActivities = logs.length
    const activeDays = days.length
    const avgPerDay = activeDays > 0 ? totalActivities / activeDays : 0
    const peakDay = days.reduce<{ day: string; count: number } | null>((max, d) => !max || d.count > max.count ? { day: d.day, count: d.count } : max, null)

    return { byCategory, days, totalHours, totalActivities, activeDays, avgPerDay, peakDay }
  }, [logs])

  function exportCSV() {
    if (!selected) return
    const header = ['Data', 'Ora', 'Azione', 'Tipo Entità', 'ID Entità', 'Dettagli']
    const rows = logs.map(l => [
      formatDay(l.created_at),
      formatTime(l.created_at),
      ACTION_LABELS[l.action] || l.action,
      l.entity_type || '',
      l.entity_id || '',
      JSON.stringify(l.details || {}).replace(/"/g, '""'),
    ])
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-operatore-${selected.nome || selected.email}-${dateFrom}_${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="text-theme-text-muted p-8 text-center">Caricamento...</div>

  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Report Operatore</h2>
          <div className="text-xs text-theme-text-muted mt-1">Home / Operatori / Report Operatore</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-theme-border bg-theme-bg-secondary p-0.5 text-xs">
            {(['oggi', '7gg', '30gg', 'mese'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriodPreset(p)}
                className="px-3 py-1.5 rounded-full text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
              >
                {p === 'oggi' ? 'Oggi' : p === '7gg' ? '7 giorni' : p === '30gg' ? '30 giorni' : 'Mese corrente'}
              </button>
            ))}
          </div>
          <button onClick={exportCSV} disabled={!selected || logs.length === 0} className="px-4 py-2 text-sm rounded-full bg-dr7-gold text-black font-medium hover:opacity-90 disabled:opacity-30 transition-opacity">
            Esporta CSV
          </button>
          <button onClick={() => window.print()} disabled={!selected} className="px-4 py-2 text-sm rounded-full border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover transition-colors disabled:opacity-30">
            Stampa / PDF
          </button>
        </div>
      </div>

      {/* ─── Operator Switcher ──────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {admins.map(admin => {
          const active = selectedAdmin === admin.id
          return (
            <button
              key={admin.id}
              onClick={() => setSelectedAdmin(admin.id)}
              className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-all ${
                active
                  ? 'bg-dr7-gold/10 border-dr7-gold text-theme-text-primary'
                  : 'bg-theme-bg-secondary border-theme-border text-theme-text-secondary hover:border-dr7-gold/50'
              }`}
            >
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${avatarColor(admin.id)}`}>
                {initials(admin.nome, admin.email)}
              </span>
              <span className="text-sm font-medium">{admin.nome || admin.email.split('@')[0]}</span>
              <span className="text-[10px] uppercase tracking-wider opacity-70">{admin.role}</span>
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ─── LEFT: main column ─────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Hero card */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold ${avatarColor(selected.id)}`}>
                  {initials(selected.nome, selected.email)}
                </div>
                <div className="flex-1">
                  <div className="text-2xl font-bold text-theme-text-primary">{selected.nome || selected.email.split('@')[0]}</div>
                  <div className="text-sm text-theme-text-secondary capitalize">{selected.role === 'superadmin' ? 'Super Admin' : 'Operatore'}</div>
                  <div className="text-xs text-theme-text-muted mt-0.5">{selected.email}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-theme-text-muted">Periodo</div>
                  <div className="text-sm font-medium text-theme-text-primary">{dateFrom} → {dateTo}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                <StatTile label="Ore Stimate" value={stats.totalHours.toFixed(1)} suffix="h" hint={`${stats.activeDays} giorni attivi`} />
                <StatTile label="Attività Totali" value={String(stats.totalActivities)} hint={`media ${stats.avgPerDay.toFixed(1)}/g`} />
                <StatTile label="Pratiche" value={String((stats.byCategory.get('contratti') || 0) + (stats.byCategory.get('fatture') || 0))} hint="Contratti + fatture" />
                <StatTile label="Clienti / Prenot." value={String((stats.byCategory.get('clienti') || 0) + (stats.byCategory.get('prenotazioni') || 0))} hint="Aggiornamenti totali" />
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-theme-text-muted mb-1">Da</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-text-muted mb-1">A</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-text-muted mb-1">Azione</label>
                <select
                  value={actionFilter}
                  onChange={e => setActionFilter(e.target.value)}
                  className="px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                >
                  <option value="">Tutte</option>
                  {ACTION_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => { if (selectedAdmin) loadLogs(selectedAdmin, page) }}
                disabled={logsLoading}
                className="px-4 py-2 text-sm rounded-full border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
              >
                {logsLoading ? 'Caricamento…' : '↻ Aggiorna'}
              </button>
            </div>

            {/* Presenze e Ore Lavorate */}
            <Section title="Presenze e Ore Lavorate" subtitle="Stimate dalla prima e ultima attività di ogni giornata">
              {logsLoading ? (
                <div className="text-theme-text-muted text-center py-8">Caricamento…</div>
              ) : stats.days.length === 0 ? (
                <div className="text-theme-text-muted text-center py-8">Nessuna giornata attiva nel periodo selezionato.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-theme-border text-theme-text-muted text-left">
                        <th className="py-2 px-3 font-medium">Giorno</th>
                        <th className="py-2 px-3 font-medium">Prima attività</th>
                        <th className="py-2 px-3 font-medium">Ultima attività</th>
                        <th className="py-2 px-3 font-medium">Ore stimate</th>
                        <th className="py-2 px-3 font-medium">Attività</th>
                        <th className="py-2 px-3 font-medium">Stato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.days.map(d => (
                        <tr key={d.day} className="border-b border-theme-border/50">
                          <td className="py-2 px-3 text-theme-text-primary font-medium">{formatDay(d.first)}</td>
                          <td className="py-2 px-3 text-theme-text-secondary">{formatTime(d.first)}</td>
                          <td className="py-2 px-3 text-theme-text-secondary">{formatTime(d.last)}</td>
                          <td className="py-2 px-3 text-theme-text-primary">{d.hours.toFixed(1)} h</td>
                          <td className="py-2 px-3 text-theme-text-secondary">{d.count}</td>
                          <td className="py-2 px-3">
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">Attivo</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* KPIs Dipendente */}
            <Section title="KPIs Dipendente" subtitle={`Totale: ${stats.totalActivities} attività registrate`}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {KPI_CATEGORIES.map(c => (
                  <KpiTile key={c.key} label={c.label} emoji={c.emoji} value={stats.byCategory.get(c.key) || 0} />
                ))}
              </div>
            </Section>

            {/* Produttività */}
            <Section title="Produttività" subtitle={stats.peakDay ? `Picco: ${formatDay(stats.peakDay.day + 'T12:00:00')} con ${stats.peakDay.count} attività` : 'Distribuzione attività per giorno'}>
              <ProductivityChart days={stats.days} />
            </Section>

            {/* Attività Recenti */}
            <Section title="Attività Recenti" subtitle="Log dettagliato delle azioni nel periodo">
              {logsLoading ? (
                <div className="text-theme-text-muted text-center py-8">Caricamento log...</div>
              ) : logs.length === 0 ? (
                <div className="text-theme-text-muted text-center py-8">Nessuna attività trovata.</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-theme-border text-theme-text-muted text-left">
                          <th className="py-3 px-3 font-medium">Data/Ora</th>
                          <th className="py-3 px-3 font-medium">Azione</th>
                          <th className="py-3 px-3 font-medium">Dettaglio</th>
                          <th className="py-3 px-3 font-medium w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map(log => {
                          const { title, meta } = formatAdminLog(log)
                          const entityLabel = formatEntityLabel(log)
                          const isExpanded = expandedIds.has(log.id)
                          const hasDetails = log.details && Object.keys(log.details).length > 0
                          return (
                            <Fragment key={log.id}>
                              <tr
                                onClick={() => {
                                  if (!hasDetails) return
                                  setExpandedIds(prev => {
                                    const next = new Set(prev)
                                    if (next.has(log.id)) next.delete(log.id)
                                    else next.add(log.id)
                                    return next
                                  })
                                }}
                                className={`border-b border-theme-border/50 transition-colors ${hasDetails ? 'cursor-pointer hover:bg-theme-bg-hover' : ''}`}
                              >
                                <td className="py-3 px-3 whitespace-nowrap text-theme-text-secondary align-top">{formatDateTime(log.created_at)}</td>
                                <td className="py-3 px-3 align-top">
                                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-dr7-gold/10 text-dr7-gold">
                                    {title}
                                  </span>
                                </td>
                                <td className="py-3 px-3 text-theme-text-secondary align-top">
                                  {meta && <div className="text-sm">{meta}</div>}
                                  {entityLabel && <div className="text-xs text-theme-text-muted mt-0.5 font-mono">{entityLabel}</div>}
                                  {!meta && !entityLabel && <span className="text-theme-text-muted">—</span>}
                                </td>
                                <td className="py-3 px-3 text-theme-text-muted align-top text-xs">
                                  {hasDetails && (isExpanded ? '▾' : '▸')}
                                </td>
                              </tr>
                              {isExpanded && hasDetails && (
                                <tr className="border-b border-theme-border/50 bg-theme-bg-tertiary/30">
                                  <td colSpan={4} className="py-2 px-3">
                                    <pre className="text-xs text-theme-text-muted font-mono whitespace-pre-wrap break-all">
                                      {JSON.stringify(log.details, null, 2)}
                                    </pre>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <button
                      onClick={() => handlePageChange(page - 1)}
                      disabled={page === 0}
                      className="px-4 py-2 text-sm rounded-full border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Precedente
                    </button>
                    <span className="text-sm text-theme-text-muted">Pagina {page + 1}</span>
                    <button
                      onClick={() => handlePageChange(page + 1)}
                      disabled={logs.length < PAGE_SIZE}
                      className="px-4 py-2 text-sm rounded-full border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Successiva
                    </button>
                  </div>
                </>
              )}
            </Section>
          </div>

          {/* ─── RIGHT: sidebar ─────────────────────────────────────────── */}
          <div className="space-y-6">
            <Section title="Riepilogo Periodo">
              <SummaryRow label="Periodo" value={`${dateFrom} → ${dateTo}`} />
              <SummaryRow label="Giorni attivi" value={String(stats.activeDays)} />
              <SummaryRow label="Ore stimate" value={`${stats.totalHours.toFixed(1)} h`} />
              <SummaryRow label="Attività totali" value={String(stats.totalActivities)} />
              <SummaryRow label="Media giornaliera" value={`${stats.avgPerDay.toFixed(1)} attività`} />
              <SummaryRow label="Ultimo accesso" value={logs[0] ? formatDateTime(logs[0].created_at) : '—'} />
            </Section>

            <Section title="Distribuzione Attività">
              <DistributionList byCategory={stats.byCategory} total={stats.totalActivities} />
            </Section>

            <Section title="Azioni Rapide">
              <div className="space-y-2">
                <ActionRow label="Esporta CSV" emoji="⬇" onClick={exportCSV} disabled={logs.length === 0} />
                <ActionRow label="Stampa / PDF" emoji="🖨" onClick={() => window.print()} />
                <ActionRow label="Aggiorna dati" emoji="↻" onClick={() => { if (selectedAdmin) loadLogs(selectedAdmin, page) }} />
                <ActionRow label="Filtra solo login" emoji="🔑" onClick={() => setActionFilter('login')} />
                <ActionRow label="Reset filtri" emoji="✕" onClick={() => { setActionFilter(''); setPeriodPreset('mese') }} />
              </div>
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-theme-text-primary">{title}</h3>
        {subtitle && <div className="text-xs text-theme-text-muted mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

function StatTile({ label, value, suffix, hint }: { label: string; value: string; suffix?: string; hint?: string }) {
  return (
    <div className="bg-theme-bg-tertiary/40 border border-theme-border rounded-xl p-3">
      <div className="text-xs text-theme-text-muted">{label}</div>
      <div className="text-2xl font-bold text-theme-text-primary mt-1">
        {value}
        {suffix && <span className="text-base font-medium text-theme-text-secondary ml-1">{suffix}</span>}
      </div>
      {hint && <div className="text-[11px] text-theme-text-muted mt-1">{hint}</div>}
    </div>
  )
}

function KpiTile({ label, emoji, value }: { label: string; emoji: string; value: number }) {
  return (
    <div className="bg-theme-bg-tertiary/40 border border-theme-border rounded-xl p-3 text-center">
      <div className="text-xl">{emoji}</div>
      <div className="text-2xl font-bold text-theme-text-primary mt-1">{value}</div>
      <div className="text-xs text-theme-text-muted mt-0.5">{label}</div>
    </div>
  )
}

function ProductivityChart({ days }: { days: Array<{ day: string; count: number }> }) {
  if (days.length === 0) return <div className="text-theme-text-muted text-sm py-4">Nessun dato.</div>
  const ordered = [...days].reverse() // chronological left-to-right
  const max = Math.max(...ordered.map(d => d.count), 1)
  return (
    <div className="flex items-end gap-1.5 h-40">
      {ordered.map(d => {
        const h = (d.count / max) * 100
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center justify-end min-w-0" title={`${d.day}: ${d.count} attività`}>
            <div className="text-[10px] text-theme-text-muted">{d.count}</div>
            <div className="w-full bg-dr7-gold/70 hover:bg-dr7-gold rounded-t transition-colors" style={{ height: `${h}%`, minHeight: '4px' }} />
            <div className="text-[10px] text-theme-text-muted mt-1 truncate">{d.day.slice(5)}</div>
          </div>
        )
      })}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-theme-border/40 last:border-b-0 text-sm">
      <span className="text-theme-text-muted">{label}</span>
      <span className="text-theme-text-primary font-medium text-right">{value}</span>
    </div>
  )
}

function DistributionList({ byCategory, total }: { byCategory: Map<string, number>; total: number }) {
  if (total === 0) return <div className="text-theme-text-muted text-sm">Nessuna attività.</div>
  return (
    <div className="space-y-2">
      {KPI_CATEGORIES.filter(c => (byCategory.get(c.key) || 0) > 0).map(c => {
        const v = byCategory.get(c.key) || 0
        const pct = total > 0 ? (v / total) * 100 : 0
        return (
          <div key={c.key}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-theme-text-secondary">{c.emoji} {c.label}</span>
              <span className="text-theme-text-muted">{v} · {pct.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 bg-theme-bg-tertiary rounded-full overflow-hidden">
              <div className="h-full bg-dr7-gold" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ActionRow({ label, emoji, onClick, disabled }: { label: string; emoji: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-theme-border text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:border-dr7-gold/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <span className="flex items-center gap-2"><span>{emoji}</span><span>{label}</span></span>
      <span className="text-theme-text-muted">›</span>
    </button>
  )
}
