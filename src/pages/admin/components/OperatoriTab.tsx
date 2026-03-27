import { useState, useEffect } from 'react'
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function OperatoriTab() {
  const [admins, setAdmins] = useState<Admin[]>([])
  const [selectedAdmin, setSelectedAdmin] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
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
                      <th className="py-3 px-3 font-medium">Data/Ora</th>
                      <th className="py-3 px-3 font-medium">Azione</th>
                      <th className="py-3 px-3 font-medium">Entita</th>
                      <th className="py-3 px-3 font-medium">Dettagli</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id} className="border-b border-theme-border/50 hover:bg-theme-bg-hover transition-colors">
                        <td className="py-3 px-3 whitespace-nowrap text-theme-text-secondary">{formatDate(log.created_at)}</td>
                        <td className="py-3 px-3">
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-dr7-gold/10 text-dr7-gold">
                            {ACTION_LABELS[log.action] || log.action}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-theme-text-secondary">
                          {log.entity_type && <span className="text-theme-text-muted text-xs uppercase">{log.entity_type}</span>}
                          {log.entity_id && <span className="ml-1 text-theme-text-primary font-mono text-xs">{log.entity_id.substring(0, 8)}...</span>}
                        </td>
                        <td className="py-3 px-3 text-theme-text-muted text-xs max-w-xs truncate">
                          {log.details && Object.keys(log.details).length > 0 ? (
                            <span title={JSON.stringify(log.details, null, 2)}>
                              {Object.entries(log.details).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(', ')}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
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
