import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import DynamicCustomerForm from './DynamicCustomerForm'
import CustomerDocuments from './CustomerDocuments'
import Button from './Button'

type StatusCliente = 'standard' | 'member' | 'elite' | 'blacklist'

interface Customer {
  id: string
  tipo_cliente: 'azienda' | 'persona_fisica' | 'pubblica_amministrazione'
  nazione: string
  created_at: string
  // Azienda
  denominazione?: string
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

export default function ClientiTab() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState<'all' | 'azienda' | 'persona_fisica' | 'pubblica_amministrazione'>('all')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  useEffect(() => {
    loadCustomers()
  }, [])

  async function loadCustomers() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('customers_extended')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setCustomers(data || [])
    } catch (error) {
      console.error('Failed to load customers:', error)
    } finally {
      setLoading(false)
    }
  }

  const getDisplayName = (customer: Customer) => {
    if (customer.tipo_cliente === 'azienda') {
      return customer.denominazione || 'N/A'
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

  const getStatusLabel = (status: StatusCliente | undefined) => {
    switch (status) {
      case 'elite':
        return 'Elite'
      case 'member':
        return 'Member'
      case 'blacklist':
        return 'Black List'
      default:
        return 'Standard'
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
        return 'bg-gray-700 text-gray-400 border border-gray-600'
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
    } catch (error) {
      console.error('Failed to update status:', error)
      alert('Errore durante l\'aggiornamento dello status')
    }
  }

  const filteredCustomers = filter === 'all'
    ? customers
    : customers.filter(c => c.tipo_cliente === filter)

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento clienti...</p>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 bg-gradient-to-r from-dr7-gold/20 to-dr7-gold/5 border border-dr7-gold/30 rounded-full p-6">
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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary mb-2">Gestione Clienti</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-full text-sm ${
                filter === 'all'
                  ? 'bg-dr7-gold text-black font-semibold'
                  : 'bg-gray-700 text-theme-text-secondary hover:bg-gray-600'
              }`}
            >
              Tutti ({customers.length})
            </button>
            <button
              onClick={() => setFilter('azienda')}
              className={`px-3 py-1 rounded-full text-sm ${
                filter === 'azienda'
                  ? 'bg-dr7-gold text-black font-semibold'
                  : 'bg-gray-700 text-theme-text-secondary hover:bg-gray-600'
              }`}
            >
              Aziende ({customers.filter(c => c.tipo_cliente === 'azienda').length})
            </button>
            <button
              onClick={() => setFilter('persona_fisica')}
              className={`px-3 py-1 rounded-full text-sm ${
                filter === 'persona_fisica'
                  ? 'bg-dr7-gold text-black font-semibold'
                  : 'bg-gray-700 text-theme-text-secondary hover:bg-gray-600'
              }`}
            >
              Persone ({customers.filter(c => c.tipo_cliente === 'persona_fisica').length})
            </button>
            <button
              onClick={() => setFilter('pubblica_amministrazione')}
              className={`px-3 py-1 rounded-full text-sm ${
                filter === 'pubblica_amministrazione'
                  ? 'bg-dr7-gold text-black font-semibold'
                  : 'bg-gray-700 text-theme-text-secondary hover:bg-gray-600'
              }`}
            >
              P.A. ({customers.filter(c => c.tipo_cliente === 'pubblica_amministrazione').length})
            </button>
          </div>
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
        <div className=" rounded-lg border border-theme-border p-8 text-center text-gray-500">
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
                      {getDisplayName(customer)}
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
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        customer.source === 'admin'
                          ? 'bg-blue-900 text-blue-300'
                          : 'bg-green-900 text-green-300'
                      }`}>
                        {customer.source === 'admin' ? 'Admin' : 'Website'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        onClick={() => setSelectedCustomer(customer)}
                        className="px-3 py-1.5 bg-dr7-gold hover:bg-yellow-500 text-black rounded-full text-xs font-medium transition-colors"
                      >
                        Documenti
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
