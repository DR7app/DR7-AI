import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../../../supabaseClient'

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
  cancel_booking: 'Annullamento prenotazione',
  cancel_carwash: 'Annullamento lavaggio',
  cancel_mechanical: 'Annullamento meccanica',
  generate_contract: 'Generazione contratto',
  resend_contract: 'Reinvio contratto',
  generate_fattura: 'Generazione fattura',
  extend_booking: 'Estensione prenotazione',
  mark_paid: 'Segna pagato',
  create_penalty: 'Creazione penale',
  create_danni: 'Creazione danno',
  create_danni_penali: 'Creazione danni/penali',
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
  bulk_delete_fatture: 'Eliminazione fatture multiple',
  create_nota_di_credito: 'Nota di credito',
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
  cassa_cauzione: 'Cassa cauzione',
  limitation_override_approved: 'Override limitazione approvato',
  // Virtual actions (stored as edit_booking with _subaction, unwrapped on display)
  preventivo_created: 'Creazione preventivo',
  preventivo_updated: 'Modifica preventivo',
  preventivo_sent: 'Invio preventivo WhatsApp',
  preventivo_converted: 'Conversione preventivo',
  preventivo_rejected: 'Rifiuto preventivo',
  centralina_pro_updated: 'Modifica Centralina Pro',
  system_message_updated: 'Modifica template messaggio',
  system_message_toggled: 'Toggle template messaggio',
  system_message_created: 'Nuovo template messaggio',
  whatsapp_sent: 'Invio WhatsApp',
  whatsapp_free_text: 'Messaggio libero WhatsApp',
  whatsapp_bulk_send: 'Invio massivo WhatsApp',
}

const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))

// Unwrap the real action when it was stored as edit_booking + details._subaction
// (used to bypass the CHECK constraint on admin_activity_log.action).
function resolveAction(log: { action: string; details: Record<string, any> | null }): string {
  const sub = log.details?._subaction
  return typeof sub === 'string' ? sub : log.action
}

// Human-readable labels for detail keys (snake_case → Italian)
const DETAIL_LABELS: Record<string, string> = {
  customer: 'Cliente',
  customer_name: 'Cliente',
  customer_email: 'Email',
  customer_phone: 'Telefono',
  cliente: 'Cliente',
  vehicle: 'Veicolo',
  vehicle_name: 'Veicolo',
  vehicle_plate: 'Targa',
  plate: 'Targa',
  pickup_date: 'Ritiro',
  dropoff_date: 'Riconsegna',
  new_dropoff: 'Nuova riconsegna',
  amount: 'Importo',
  amountPaid: 'Importo pagato',
  amount_paid: 'Importo pagato',
  total: 'Totale',
  status: 'Stato',
  old_status: 'Stato precedente',
  new_status: 'Nuovo stato',
  payment_method: 'Metodo pagamento',
  paymentMethod: 'Metodo pagamento',
  method: 'Metodo',
  reason: 'Motivo',
  motivo: 'Motivo',
  email: 'Email',
  document: 'Documento',
  signer: 'Firmatario',
  service: 'Servizio',
  service_name: 'Servizio',
  fattura_number: 'Numero fattura',
  fattura_id: 'ID fattura',
  booking_id: 'ID prenotazione',
  extension_index: 'Indice estensione',
  type: 'Tipo',
  tipo: 'Tipo',
  changes: 'Modifiche',
  diff: 'Modifiche',
  before: 'Prima',
  after: 'Dopo',
  nights: 'Notti',
  days: 'Giorni',
  discount: 'Sconto',
  km_included: 'Km inclusi',
  notes: 'Note',
  note: 'Note',
}

function formatDetailKey(key: string): string {
  return DETAIL_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatDetailValue(value: any): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Sì' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    // Try to format ISO dates
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      try {
        return new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      } catch { return value }
    }
    return value
  }
  if (Array.isArray(value)) return value.map(formatDetailValue).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function OperatoriTab() {
  const [admins, setAdmins] = useState<Admin[]>([])
  const [selectedAdmin, setSelectedAdmin] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [entityNames, setEntityNames] = useState<Map<string, string>>(new Map())
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [logsLoading, setLogsLoading] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [page, setPage] = useState(0)
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
    }
    setLoading(false)
  }

  async function resolveEntityNames(logs: LogEntry[]) {
    // Group entity IDs by type for batch lookups
    const byType: Record<string, Set<string>> = {}
    for (const log of logs) {
      if (!log.entity_id || !log.entity_type) continue
      if (!byType[log.entity_type]) byType[log.entity_type] = new Set()
      byType[log.entity_type].add(log.entity_id)
    }

    const names = new Map<string, string>()

    // Bookings → customer_name + vehicle
    if (byType.booking?.size) {
      const ids = Array.from(byType.booking)
      const { data } = await supabase
        .from('bookings')
        .select('id, customer_name, vehicle_name, vehicle_plate, pickup_date')
        .in('id', ids)
      data?.forEach(b => {
        const date = b.pickup_date ? new Date(b.pickup_date).toLocaleDateString('it-IT') : ''
        names.set(`booking:${b.id}`, `${b.customer_name || 'Cliente'} · ${b.vehicle_name || ''}${b.vehicle_plate ? ' (' + b.vehicle_plate + ')' : ''}${date ? ' · ' + date : ''}`)
      })
    }

    // Car wash bookings
    if (byType.carwash_booking?.size) {
      const ids = Array.from(byType.carwash_booking)
      const { data } = await supabase
        .from('bookings')
        .select('id, customer_name, booking_details')
        .in('id', ids)
      data?.forEach(b => {
        const service = b.booking_details?.service_name || b.booking_details?.service || ''
        names.set(`carwash_booking:${b.id}`, `${b.customer_name || 'Cliente'}${service ? ' · ' + service : ''}`)
      })
    }

    // Mechanical bookings
    if (byType.mechanical_booking?.size) {
      const ids = Array.from(byType.mechanical_booking)
      const { data } = await supabase
        .from('bookings')
        .select('id, customer_name, booking_details')
        .in('id', ids)
      data?.forEach(b => {
        const service = b.booking_details?.service_name || b.booking_details?.service || ''
        names.set(`mechanical_booking:${b.id}`, `${b.customer_name || 'Cliente'}${service ? ' · ' + service : ''}`)
      })
    }

    // Fatture
    if (byType.fattura?.size) {
      const rawIds = Array.from(byType.fattura)
      // Handle bulk_delete_fatture which stores CSV of IDs
      const expandedIds = rawIds.flatMap(id => id.includes(',') ? id.split(',') : [id])
      const { data } = await supabase
        .from('fatture')
        .select('id, numero_fattura, customer_name, importo_totale')
        .in('id', expandedIds)
      data?.forEach(f => {
        const total = typeof f.importo_totale === 'number' ? f.importo_totale.toFixed(2) : (f.importo_totale || '0')
        names.set(`fattura:${f.id}`, `${f.numero_fattura || 'N/A'} · ${f.customer_name || ''} · €${total}`)
      })
    }

    // Customers
    if (byType.customer?.size) {
      const ids = Array.from(byType.customer)
      const { data } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, email')
        .in('id', ids)
      data?.forEach(c => {
        const full = [c.cognome, c.nome].filter(Boolean).join(' ') || c.email || 'Cliente'
        names.set(`customer:${c.id}`, full)
      })
    }

    // Cauzioni
    if (byType.cauzione?.size) {
      const ids = Array.from(byType.cauzione)
      const { data } = await supabase
        .from('cauzioni')
        .select('id, cliente_nome, importo')
        .in('id', ids)
      data?.forEach(c => {
        const amount = typeof c.importo === 'number' ? c.importo.toFixed(2) : (c.importo || '0')
        names.set(`cauzione:${c.id}`, `${c.cliente_nome || 'Cliente'} · €${amount}`)
      })
    }

    setEntityNames(names)
  }

  async function loadLogs(adminId: string, pageNum: number) {
    setLogsLoading(true)
    setExpandedRows(new Set())
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
    const loaded = data || []
    setLogs(loaded)
    setLogsLoading(false)
    resolveEntityNames(loaded)
  }

  function handlePageChange(newPage: number) {
    setPage(newPage)
    if (selectedAdmin) loadLogs(selectedAdmin, newPage)
  }

  function toggleRow(id: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderEntity(log: LogEntry): React.ReactNode {
    if (!log.entity_id) {
      return log.entity_type ? <span className="text-theme-text-muted text-xs uppercase">{log.entity_type}</span> : <span className="text-theme-text-muted">—</span>
    }
    const key = `${log.entity_type}:${log.entity_id}`
    const resolved = entityNames.get(key)
    return (
      <div>
        {log.entity_type && <div className="text-theme-text-muted text-[10px] uppercase tracking-wider">{log.entity_type}</div>}
        {resolved ? (
          <div className="text-theme-text-primary text-xs">{resolved}</div>
        ) : (
          <div className="text-theme-text-primary font-mono text-[11px]">{log.entity_id.substring(0, 8)}…</div>
        )}
      </div>
    )
  }

  if (loading) return <div className="text-theme-text-muted p-8 text-center">Caricamento...</div>

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-theme-text-primary">Operatori</h2>

      {/* Operator Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {admins.map(admin => (
          <button
            key={admin.id}
            onClick={() => setSelectedAdmin(admin.id)}
            className={`p-4 rounded-2xl border text-left transition-all ${
              selectedAdmin === admin.id
                ? 'bg-dr7-gold/10 border-dr7-gold text-theme-text-primary'
                : 'bg-theme-bg-secondary border-theme-border text-theme-text-secondary hover:border-dr7-gold/50'
            }`}
          >
            <div className="font-semibold text-lg">{admin.nome || admin.email}</div>
            <div className="text-sm text-theme-text-muted">{admin.email}</div>
            <div className="text-xs mt-1 uppercase tracking-wider text-theme-text-muted">{admin.role}</div>
          </button>
        ))}
      </div>

      {/* Log Section */}
      {selectedAdmin && (
        <div className="space-y-4">
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
          </div>

          {/* Log Table */}
          {logsLoading ? (
            <div className="text-theme-text-muted text-center py-8">Caricamento log...</div>
          ) : logs.length === 0 ? (
            <div className="text-theme-text-muted text-center py-8">Nessuna attivita trovata.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-theme-border text-theme-text-muted text-left">
                      <th className="py-3 px-3 font-medium w-8"></th>
                      <th className="py-3 px-3 font-medium">Data/Ora</th>
                      <th className="py-3 px-3 font-medium">Azione</th>
                      <th className="py-3 px-3 font-medium">Entita</th>
                      <th className="py-3 px-3 font-medium">Riepilogo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => {
                      const isExpanded = expandedRows.has(log.id)
                      const detailKeys = log.details ? Object.keys(log.details) : []
                      const hasDetails = detailKeys.length > 0
                      return (
                        <Fragment key={log.id}>
                          <tr
                            className={`border-b border-theme-border/50 transition-colors ${hasDetails ? 'cursor-pointer hover:bg-theme-bg-hover' : ''}`}
                            onClick={() => hasDetails && toggleRow(log.id)}
                          >
                            <td className="py-3 px-3 text-theme-text-muted">
                              {hasDetails && (
                                <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                                </svg>
                              )}
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap text-theme-text-secondary">{formatDate(log.created_at)}</td>
                            <td className="py-3 px-3">
                              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-dr7-gold/10 text-dr7-gold">
                                {ACTION_LABELS[resolveAction(log)] || resolveAction(log)}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-theme-text-secondary">
                              {renderEntity(log)}
                            </td>
                            <td className="py-3 px-3 text-theme-text-muted text-xs">
                              {hasDetails ? (
                                <span className="line-clamp-2">
                                  {detailKeys.slice(0, 4).map(k => `${formatDetailKey(k)}: ${formatDetailValue(log.details[k])}`).join(' · ')}
                                  {detailKeys.length > 4 && ` · +${detailKeys.length - 4}`}
                                </span>
                              ) : '—'}
                            </td>
                          </tr>
                          {isExpanded && hasDetails && (
                            <tr className="border-b border-theme-border/50 bg-theme-bg-secondary/40">
                              <td></td>
                              <td colSpan={4} className="py-4 px-3">
                                <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                                  {detailKeys.map(k => (
                                    <div key={k} className="flex gap-2">
                                      <dt className="text-theme-text-muted font-medium min-w-[120px]">{formatDetailKey(k)}:</dt>
                                      <dd className="text-theme-text-primary break-all">{formatDetailValue(log.details[k])}</dd>
                                    </div>
                                  ))}
                                  {log.entity_id && (
                                    <div className="flex gap-2 md:col-span-2">
                                      <dt className="text-theme-text-muted font-medium min-w-[120px]">ID completo:</dt>
                                      <dd className="text-theme-text-primary font-mono break-all">{log.entity_id}</dd>
                                    </div>
                                  )}
                                </dl>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between">
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
        </div>
      )}
    </div>
  )
}
