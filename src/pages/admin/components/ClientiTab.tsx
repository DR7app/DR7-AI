import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import DynamicCustomerForm from './DynamicCustomerForm'
import CustomerDocuments from './CustomerDocuments'
import ReportClienteModal from './ReportClienteModal'
import Button from './Button'
import ClientStatusBadge from '../../../components/ClientStatusBadge'
import { useClientStatus, type ClientTier } from '../../../contexts/ClientStatusContext'

type StatusFilter = 'all' | ClientTier | 'dr7_club'
import toast from 'react-hot-toast'

type StatusCliente = 'standard' | 'member' | 'elite' | 'blacklist'

interface Customer {
  id: string
  user_id?: string | null
  tipo_cliente: 'azienda' | 'persona_fisica' | 'pubblica_amministrazione'
  nazione: string
  created_at: string
  // Azienda
  denominazione?: string
  ragione_sociale?: string
  partita_iva?: string
  // Persona Fisica
  nome?: string
  cognome?: string
  telefono?: string
  email?: string
  pec?: string
  // Common
  codice_fiscale?: string
  indirizzo?: string
  // Pubblica Amministrazione
  codice_univoco?: string
  ente_ufficio?: string
  citta?: string
  // Meta
  source?: string
  // Status
  status_cliente?: StatusCliente
}

// DR7 Club tier — same thresholds the website uses in utils/dr7club.ts.
type ClubTier = 'access' | 'black' | 'signature'
function tierFromSpend(annualSpendEur: number): ClubTier {
  if (annualSpendEur >= 10000) return 'signature'
  if (annualSpendEur >= 3000) return 'black'
  return 'access'
}
const tierMeta: Record<ClubTier, { label: string; reward: string; badge: string }> = {
  access:    { label: 'Access',    reward: '2%', badge: 'bg-gray-500/20 text-gray-300 border border-gray-500/40' },
  black:     { label: 'Black',     reward: '3%', badge: 'bg-purple-500/20 text-purple-300 border border-purple-500/50' },
  signature: { label: 'Signature', reward: '4%', badge: 'bg-amber-500/20 text-amber-300 border border-amber-500/50' },
}

export default function ClientiTab() {
  const { refresh: refreshClientStatus, setTier: setClientStatusTier, lookup: lookupClientStatus } = useClientStatus()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState<'all' | 'azienda' | 'persona_fisica' | 'pubblica_amministrazione'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [reportCustomerId, setReportCustomerId] = useState<string | null>(null)
  // Annual spend per auth user_id (last 12 months, paid bookings only).
  // Drives the Livello DR7 Club badge on each row.
  const [annualSpendByUserId, setAnnualSpendByUserId] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    loadCustomers()
    loadAnnualSpend()
  }, [])

  async function loadCustomers() {
    setLoading(true)
    try {
      // Supabase caps SELECT * at 1000 rows by default. Page through with
      // .range() until we get a short page so the count matches the Lead
      // tab (which uses /list-customers and naturally paginates).
      const PAGE_SIZE = 1000
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all: any[] = []
      let from = 0
      // Fetch up to 50 pages (50k customers) before bailing — paranoid limit
      for (let i = 0; i < 50; i++) {
        const { data, error } = await supabase
          .from('customers_extended')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        all.push(...data)
        if (data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
      setCustomers(all)
    } catch (error) {
      console.error('Failed to load customers:', error)
      toast.error('Errore caricamento clienti')
    } finally {
      setLoading(false)
    }
  }

  async function loadAnnualSpend() {
    try {
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      // DR7 Club tier = real CARD money into DR7 over last 12 months:
      // card-paid bookings + card-paid wallet recharges. Wallet-paid
      // bookings are excluded (the recharge that funded them already
      // counted).
      const map = new Map<string, number>()

      const isCardPayment = (pm?: string | null) => {
        const m = (pm || '').toLowerCase()
        if (!m) return false
        if (m.includes('wallet') || m.includes('credito') || m.includes('credit_wallet')) return false
        if (m.includes('contanti') || m.includes('cash')) return false
        if (m.includes('bonifico') || m.includes('wire') || m.includes('bank')) return false
        if (m.includes('gift')) return false
        return m.includes('card') || m.includes('carta') || m.includes('nexi')
          || m.includes('stripe') || m.includes('pos') || m.includes('pay by link')
          || m.includes('bancomat') || m.includes('debit')
      }

      const { data: bkRows, error: bkErr } = await supabase
        .from('bookings')
        .select('user_id, price_total, payment_method')
        .not('user_id', 'is', null)
        .in('status', ['completed', 'completata', 'confirmed', 'active'])
        .in('payment_status', ['paid', 'completed', 'succeeded'])
        .gte('booked_at', oneYearAgo.toISOString())
      if (bkErr) throw bkErr
      for (const b of (bkRows || [])) {
        if (!b.user_id) continue
        if (!isCardPayment(b.payment_method)) continue
        map.set(b.user_id, (map.get(b.user_id) || 0) + (b.price_total || 0))
      }

      const { data: rcRows, error: rcErr } = await supabase
        .from('credit_wallet_purchases')
        .select('user_id, amount, payment_status, created_at')
        .not('user_id', 'is', null)
        .in('payment_status', ['succeeded', 'paid', 'completed'])
        .gte('created_at', oneYearAgo.toISOString())
      if (rcErr) throw rcErr
      for (const r of (rcRows || [])) {
        if (!r.user_id) continue
        map.set(r.user_id, (map.get(r.user_id) || 0) + (r.amount || 0))
      }

      // Convert cents → euros on the way out.
      const eurMap = new Map<string, number>()
      for (const [uid, cents] of map) eurMap.set(uid, cents / 100)
      setAnnualSpendByUserId(eurMap)
    } catch (err) {
      console.error('Failed to load annual spend:', err)
    }
  }

  const livelloFor = (c: Customer): { tier: ClubTier; annualSpend: number } => {
    const annualSpend = c.user_id ? (annualSpendByUserId.get(c.user_id) || 0) : 0
    return { tier: tierFromSpend(annualSpend), annualSpend }
  }

  const getDisplayName = (customer: Customer) => {
    if (customer.tipo_cliente === 'azienda') {
      return customer.ragione_sociale || customer.denominazione || 'N/A'
    } else if (customer.tipo_cliente === 'persona_fisica') {
      return `${customer.nome || ''} ${customer.cognome || ''}`.trim() || 'N/A'
    } else if (customer.tipo_cliente === 'pubblica_amministrazione') {
      return customer.ente_ufficio || 'N/A'
    }
    return 'N/A'
  }

  const getTipoLabel = (tipo: string) => {
    switch (tipo) {
      case 'azienda':
        return 'Azienda'
      case 'persona_fisica':
        return 'Persona Fisica'
      case 'pubblica_amministrazione':
        return 'Pubblica Amministrazione'
      default:
        return tipo
    }
  }



  const getStatusBadgeClass = (status: StatusCliente | undefined) => {
    switch (status) {
      case 'elite':
        return 'bg-amber-500/20 text-amber-400 border border-amber-500/50'
      case 'member':
        return 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
      case 'blacklist':
        return 'bg-red-500/20 text-red-400 border border-red-500/50'
      default:
        return 'bg-theme-bg-tertiary text-theme-text-muted border border-theme-border'
    }
  }

  const handleStatusChange = async (customerId: string, newStatus: StatusCliente) => {
    try {
      const { error } = await supabase
        .from('customers_extended')
        .update({ status_cliente: newStatus })
        .eq('id', customerId)

      if (error) throw error

      // Update local state
      setCustomers(prev => prev.map(c =>
        c.id === customerId ? { ...c, status_cliente: newStatus } : c
      ))
      const target = customers.find(c => c.id === customerId)
      const tierForBadge = (newStatus === 'standard' || !newStatus) ? 'new' : newStatus
      setClientStatusTier(
        { customerId, userId: target?.user_id, email: target?.email, phone: target?.telefono },
        tierForBadge
      )
      refreshClientStatus()
    } catch (error) {
      console.error('Failed to update status:', error)
      toast.error('Errore durante l\'aggiornamento dello status')
    }
  }

  const resolvedTierFor = (c: Customer): { tier: ClientTier; dr7Club: boolean } => {
    const looked = lookupClientStatus({ customerId: c.id, userId: c.user_id, email: c.email, phone: c.telefono })
    const manual = (c.status_cliente && c.status_cliente !== 'standard') ? c.status_cliente : null
    const tier: ClientTier = manual ?? looked?.tier ?? 'new'
    return { tier, dr7Club: looked?.dr7Club ?? false }
  }

  const filteredByType = filter === 'all'
    ? customers
    : customers.filter(c => c.tipo_cliente === filter)

  const filteredCustomers = statusFilter === 'all'
    ? filteredByType
    : filteredByType.filter(c => {
        const { tier, dr7Club } = resolvedTierFor(c)
        if (statusFilter === 'dr7_club') return dr7Club
        return tier === statusFilter
      })

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento clienti...</p>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 bg-gradient-to-r from-dr7-gold/20 to-dr7-gold/5 border border-dr7-gold/30 rounded-2xl sm:rounded-full p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-theme-text-muted mb-1">Totale Clienti</p>
            <p className="text-4xl font-bold text-dr7-gold">{customers.length}</p>
          </div>
          <div className="text-dr7-gold">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary mb-2">Gestione Clienti</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-full text-sm min-h-[36px] ${filter === 'all'
                  ? 'bg-dr7-gold text-white font-semibold'
                  : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
                }`}
            >
              Tutti ({customers.length})
            </button>
            <button
              onClick={() => setFilter('azienda')}
              className={`px-3 py-1 rounded-full text-sm min-h-[36px] ${filter === 'azienda'
                  ? 'bg-dr7-gold text-white font-semibold'
                  : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
                }`}
            >
              Aziende ({customers.filter(c => c.tipo_cliente === 'azienda').length})
            </button>
            <button
              onClick={() => setFilter('persona_fisica')}
              className={`px-3 py-1 rounded-full text-sm min-h-[36px] ${filter === 'persona_fisica'
                  ? 'bg-dr7-gold text-white font-semibold'
                  : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
                }`}
            >
              Persone ({customers.filter(c => c.tipo_cliente === 'persona_fisica').length})
            </button>
            <button
              onClick={() => setFilter('pubblica_amministrazione')}
              className={`px-3 py-1 rounded-full text-sm min-h-[36px] ${filter === 'pubblica_amministrazione'
                  ? 'bg-dr7-gold text-white font-semibold'
                  : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
                }`}
            >
              P.A. ({customers.filter(c => c.tipo_cliente === 'pubblica_amministrazione').length})
            </button>
          </div>
          {(() => {
            const counts = customers.reduce((acc, c) => {
              const { tier, dr7Club } = resolvedTierFor(c)
              acc[tier] = (acc[tier] || 0) + 1
              if (dr7Club) acc['dr7_club'] = (acc['dr7_club'] || 0) + 1
              return acc
            }, {} as Record<string, number>)
            const buttons: { key: StatusFilter; label: string; cls: string }[] = [
              { key: 'all',       label: `Tutti gli stati (${customers.length})`, cls: 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover' },
              { key: 'new',       label: `New entry (${counts.new || 0})`,         cls: 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/40' },
              { key: 'member',    label: `Member (${counts.member || 0})`,         cls: 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/40' },
              { key: 'elite',     label: `Elite (${counts.elite || 0})`,           cls: 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/40' },
              { key: 'blacklist', label: `Blacklist (${counts.blacklist || 0})`,   cls: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/40' },
              { key: 'dr7_club',  label: `DR7 Club (${counts.dr7_club || 0})`,     cls: 'bg-[#C9A96E]/10 text-[#D4B896] hover:bg-[#C9A96E]/20 border border-[#C9A96E]/40' },
            ]
            return (
              <div className="flex flex-wrap gap-2 mt-3">
                {buttons.map(b => (
                  <button
                    key={b.key}
                    onClick={() => setStatusFilter(b.key)}
                    className={`px-3 py-1 rounded-full text-sm min-h-[36px] transition-colors ${
                      statusFilter === b.key
                        ? 'bg-dr7-gold text-white font-semibold'
                        : b.cls
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )
          })()}
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Chiudi Form' : '+ Nuovo Cliente'}
        </Button>
      </div>

      {/* Dynamic Form */}
      {showForm && (
        <DynamicCustomerForm
          onSuccess={() => {
            setShowForm(false)
            loadCustomers()
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Customers Table */}
      {filteredCustomers.length === 0 ? (
        <div className=" rounded-lg border border-theme-border p-8 text-center text-theme-text-muted">
          Nessun cliente trovato
        </div>
      ) : (
        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Tipo</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Nome/Denominazione</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Livello DR7</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Codice Fiscale</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Contatto</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Data</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Origine</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="border-t border-theme-border hover:bg-theme-bg-tertiary">
                    <td className="px-4 py-3 text-sm text-theme-text-primary">
                      <span className="inline-block px-2 py-1 rounded-full bg-dr7-gold/20 text-dr7-gold text-xs font-medium">
                        {getTipoLabel(customer.tipo_cliente)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-primary font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{getDisplayName(customer)}</span>
                        <ClientStatusBadge tier={(customer.status_cliente && customer.status_cliente !== 'standard') ? customer.status_cliente : undefined} customerId={customer.id} userId={customer.user_id} email={customer.email} />
                      </div>
                      {customer.tipo_cliente === 'azienda' && customer.partita_iva && (
                        <div className="text-xs text-theme-text-muted mt-1">P.IVA: {customer.partita_iva}</div>
                      )}
                      {customer.tipo_cliente === 'pubblica_amministrazione' && customer.codice_univoco && (
                        <div className="text-xs text-theme-text-muted mt-1">Cod. Univoco: {customer.codice_univoco}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <select
                        value={customer.status_cliente || 'standard'}
                        onChange={(e) => handleStatusChange(customer.id, e.target.value as StatusCliente)}
                        className={`px-2 py-1 rounded-full text-xs font-semibold cursor-pointer border-0 outline-none ${getStatusBadgeClass(customer.status_cliente)}`}
                      >
                        <option value="standard">Standard</option>
                        <option value="member">Member</option>
                        <option value="elite">Elite</option>
                        <option value="blacklist">Black List</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {(() => {
                        const { tier, annualSpend } = livelloFor(customer)
                        const meta = tierMeta[tier]
                        return (
                          <div className="flex flex-col gap-0.5">
                            <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${meta.badge} w-fit`}>
                              {meta.label} · {meta.reward}
                            </span>
                            {customer.user_id && (
                              <span className="text-[10px] text-theme-text-muted tabular-nums">
                                €{annualSpend.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/anno
                              </span>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-primary">
                      {customer.codice_fiscale || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-primary">
                      {customer.email && <div>{customer.email}</div>}
                      {customer.telefono && <div className="text-xs text-theme-text-muted">{customer.telefono}</div>}
                      {!customer.email && !customer.telefono && '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-primary whitespace-nowrap">
                      {new Date(customer.created_at).toLocaleDateString('it-IT')}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${customer.source === 'admin'
                          ? 'bg-blue-900 text-blue-300'
                          : 'bg-green-900 text-green-300'
                        }`}>
                        {customer.source === 'admin' ? 'Admin' : 'Website'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setReportCustomerId(customer.id)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-xs font-medium transition-colors"
                        >
                          Report
                        </button>
                        <button
                          onClick={() => setSelectedCustomer(customer)}
                          className="px-3 py-1.5 bg-dr7-gold hover:bg-[#247a6f] text-white rounded-full text-xs font-medium transition-colors"
                        >
                          Documenti
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Report Cliente Modal */}
      {reportCustomerId && (
        <ReportClienteModal
          customerId={reportCustomerId}
          onClose={() => setReportCustomerId(null)}
        />
      )}

      {/* Customer Documents Modal */}
      {selectedCustomer && (
        <CustomerDocuments
          customerId={selectedCustomer.id}
          customerName={getDisplayName(selectedCustomer)}
          onClose={() => setSelectedCustomer(null)}
        />
      )}
    </div>
  )
}
