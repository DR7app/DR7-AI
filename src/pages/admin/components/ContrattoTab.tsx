import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'

interface Contract {
  id: string
  contract_number: string
  contract_date: string
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_address: string
  customer_tax_code: string
  customer_license_number?: string
  vehicle_name: string
  rental_start_date: string
  rental_end_date: string
  daily_rate: number
  total_days: number
  total_amount: number
  deposit_amount?: number
  status: 'active' | 'completed' | 'cancelled'
  notes?: string
  created_at: string
  pdf_url?: string
  booking_id: string
  signed_pdf_url?: string
}

export default function ContrattoTab() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const [formData, setFormData] = useState({
    contract_number: '',
    contract_date: new Date().toISOString().split('T')[0],
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    customer_address: '',
    customer_tax_code: '',
    customer_license_number: '',
    vehicle_name: '',
    rental_start_date: new Date().toISOString().split('T')[0],
    rental_end_date: new Date().toISOString().split('T')[0],
    daily_rate: 0,
    deposit_amount: 0,
    status: 'active' as 'active' | 'completed' | 'cancelled',
    notes: ''
  })

  useEffect(() => {
    loadContracts()
  }, [])

  async function loadContracts() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, bookings:booking_id(customer_name, customer_email, customer_phone, booking_details)')
        .order('updated_at', { ascending: false })

      if (error) throw error
      // Resolve customer_name from booking if contract's customer_name is empty
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolved = (data || []).map((c: any) => {
        const b = c.bookings
        if (!c.customer_name && b) {
          c.customer_name = b.customer_name || b.booking_details?.customer?.fullName || ''
        }
        if (!c.customer_email && b) {
          c.customer_email = b.customer_email || b.booking_details?.customer?.email || ''
        }
        if (!c.customer_phone && b) {
          c.customer_phone = b.customer_phone || b.booking_details?.customer?.phone || ''
        }
        return c
      })
      setContracts(resolved)
    } catch (error) {
      console.error('Failed to load contracts:', error)
    } finally {
      setLoading(false)
    }
  }

  function calculateTotalDays(): number {
    const start = new Date(formData.rental_start_date)
    const end = new Date(formData.rental_end_date)
    const diffTime = Math.abs(end.getTime() - start.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays || 1
  }

  function calculateTotalAmount(): number {
    return calculateTotalDays() * formData.daily_rate
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const totalDays = calculateTotalDays()
      const totalAmount = calculateTotalAmount()

      const contractData = {
        ...formData,
        total_days: totalDays,
        total_amount: totalAmount
      }

      if (editingId) {
        const { error } = await supabase
          .from('contracts')
          .update(contractData)
          .eq('id', editingId)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('contracts')
          .insert([contractData])

        if (error) throw error
      }

      setShowForm(false)
      setEditingId(null)
      resetForm()
      loadContracts()
    } catch (error) {
      console.error('Failed to save contract:', error)
      alert('Impossibile salvare il contratto. Assicurati che la tabella "contracts" esista nel database.')
    }
  }

  function resetForm() {
    setFormData({
      contract_number: '',
      contract_date: new Date().toISOString().split('T')[0],
      customer_name: '',
      customer_email: '',
      customer_phone: '',
      customer_address: '',
      customer_tax_code: '',
      customer_license_number: '',
      vehicle_name: '',
      rental_start_date: new Date().toISOString().split('T')[0],
      rental_end_date: new Date().toISOString().split('T')[0],
      daily_rate: 0,
      deposit_amount: 0,
      status: 'active',
      notes: ''
    })
  }

  function handleEdit(contract: Contract) {
    setFormData({
      contract_number: contract.contract_number,
      contract_date: contract.contract_date,
      customer_name: contract.customer_name,
      customer_email: contract.customer_email,
      customer_phone: contract.customer_phone,
      customer_address: contract.customer_address,
      customer_tax_code: contract.customer_tax_code,
      customer_license_number: contract.customer_license_number || '',
      vehicle_name: contract.vehicle_name,
      rental_start_date: contract.rental_start_date,
      rental_end_date: contract.rental_end_date,
      daily_rate: contract.daily_rate,
      deposit_amount: contract.deposit_amount || 0,
      status: contract.status,
      notes: contract.notes || ''
    })
    setEditingId(contract.id)
    setShowForm(true)
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase
        .from('contracts')
        .delete()
        .eq('id', id)

      if (error) throw error
      loadContracts()
    } catch (error) {
      console.error('Failed to delete contract:', error)
      alert('Impossibile eliminare il contratto')
    }
  }


  const [sendingSignature, setSendingSignature] = useState<string | null>(null)

  async function handleSendSignatureEmail(contract: Contract) {
    if (!contract.pdf_url) {
      toast.error('Il contratto non ha un PDF generato.')
      return
    }
    if (!contract.customer_email) {
      toast.error('Email cliente mancante.')
      return
    }

    setSendingSignature(contract.id)
    try {
      const res = await fetch('/.netlify/functions/signature-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: contract.id, bookingId: contract.booking_id })
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.message || `Link di firma inviato via WhatsApp a ${contract.customer_phone || contract.customer_name}`)
        loadContracts()
      } else {
        toast.error(data.error || 'Errore nell\'invio')
      }
    } catch (error: unknown) {
      console.error('Signature init error:', error)
      toast.error('Errore nell\'invio della richiesta di firma')
    } finally {
      setSendingSignature(null)
    }
  }

  function handleViewAuditTrail(contract: Contract) {
    const url = `/.netlify/functions/signature-audit?contractId=${contract.id}&format=html`
    window.open(url, '_blank')
  }


  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento contratti...</p>
      </div>
    )
  }

  if (showForm) {
    return (
      <div className="bg-theme-bg-secondary rounded-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-theme-text-primary">
            {editingId ? 'Modifica Contratto' : 'Nuovo Contratto'}
          </h2>
          <button
            onClick={() => {
              setShowForm(false)
              setEditingId(null)
              resetForm()
            }}
            className="text-theme-text-muted hover:text-theme-text-primary"
          >
            ✕ Chiudi
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Contract Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Numero Contratto *</label>
              <input
                type="text"
                value={formData.contract_number}
                onChange={(e) => setFormData({ ...formData, contract_number: e.target.value })}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data Contratto *</label>
              <input
                type="date"
                value={formData.contract_date}
                onChange={(e) => setFormData({ ...formData, contract_date: e.target.value })}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                required
              />
            </div>
          </div>

          {/* Customer Info */}
          <div className="border-t border-theme-border pt-4">
            <h3 className="text-lg font-bold text-theme-text-primary mb-4">Informazioni Cliente</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Nome Cliente *</label>
                <input
                  type="text"
                  value={formData.customer_name}
                  onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Email</label>
                <input
                  type="email"
                  value={formData.customer_email}
                  onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Telefono</label>
                <input
                  type="tel"
                  value={formData.customer_phone}
                  onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Codice Fiscale</label>
                <input
                  type="text"
                  value={formData.customer_tax_code}
                  onChange={(e) => setFormData({ ...formData, customer_tax_code: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Indirizzo</label>
                <input
                  type="text"
                  value={formData.customer_address}
                  onChange={(e) => setFormData({ ...formData, customer_address: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Patente N.</label>
                <input
                  type="text"
                  value={formData.customer_license_number}
                  onChange={(e) => setFormData({ ...formData, customer_license_number: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
            </div>
          </div>

          {/* Rental Info */}
          <div className="border-t border-theme-border pt-4">
            <h3 className="text-lg font-bold text-theme-text-primary mb-4">Dettagli Noleggio</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Veicolo *</label>
                <input
                  type="text"
                  value={formData.vehicle_name}
                  onChange={(e) => setFormData({ ...formData, vehicle_name: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data Inizio *</label>
                <input
                  type="date"
                  value={formData.rental_start_date}
                  onChange={(e) => setFormData({ ...formData, rental_start_date: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data Fine *</label>
                <input
                  type="date"
                  value={formData.rental_end_date}
                  onChange={(e) => setFormData({ ...formData, rental_end_date: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Tariffa Giornaliera (€) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.daily_rate}
                  onChange={(e) => setFormData({ ...formData, daily_rate: parseFloat(e.target.value) })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cauzione (€)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.deposit_amount}
                  onChange={(e) => setFormData({ ...formData, deposit_amount: parseFloat(e.target.value) })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Stato</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as typeof formData.status })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                >
                  <option value="active">Attivo</option>
                  <option value="completed">Completato</option>
                  <option value="cancelled">Cancellato</option>
                </select>
              </div>
            </div>

            {/* Calculated Totals */}
            <div className="mt-4 p-4 bg-theme-bg-tertiary rounded">
              <div className="flex justify-between text-theme-text-primary mb-2">
                <span>Giorni Totali:</span>
                <span className="font-bold">{calculateTotalDays()}</span>
              </div>
              <div className="flex justify-between text-theme-text-primary text-lg">
                <span>Totale:</span>
                <span className="font-bold text-dr7-gold">€{calculateTotalAmount().toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">Note</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="submit"
              className="flex-1 bg-dr7-gold hover:bg-[#247a6f] text-white font-bold py-3 px-4 rounded-full transition-colors"
            >
              {editingId ? 'Aggiorna Contratto' : 'Crea Contratto'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
                resetForm()
              }}
              className="px-6 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary font-bold py-3 rounded-full transition-colors"
            >
              Annulla
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-theme-text-primary">📄 Contratti</h2>
        <button
          onClick={() => setShowForm(true)}
          className="bg-dr7-gold hover:bg-[#247a6f] text-white font-bold py-2 px-4 rounded-full transition-colors"
        >
          + Nuovo Contratto
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
        <input
          type="text"
          placeholder="Cerca cliente..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-4 py-2 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold transition-colors"
        />
      </div>

      {/* Contracts List */}
      {contracts.length === 0 ? (
        <div className="bg-theme-bg-secondary rounded-lg p-12 text-center">
          <p className="text-theme-text-muted text-lg mb-4">Nessun contratto trovato</p>
          <button
            onClick={() => setShowForm(true)}
            className="bg-dr7-gold hover:bg-[#247a6f] text-white font-bold py-2 px-6 rounded-full transition-colors"
          >
            Crea il primo contratto
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {contracts.filter(contract => {
            if (!searchQuery) return true
            const query = searchQuery.toLowerCase()
            return (
              contract.customer_name.toLowerCase().includes(query) ||
              contract.contract_number.toLowerCase().includes(query) ||
              contract.customer_email.toLowerCase().includes(query)
            )
          }).map((contract) => (
            <div key={contract.id} className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-theme-text-primary">{contract.contract_number}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${contract.status === 'active' ? 'bg-green-600 text-theme-text-primary' :
                      contract.status === 'completed' ? 'bg-blue-600 text-theme-text-primary' :
                        'bg-red-600 text-theme-text-primary'
                      }`}>
                      {contract.status === 'active' ? 'Attivo' :
                        contract.status === 'completed' ? 'Completato' : 'Cancellato'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-theme-text-muted">Cliente:</span>
                      <p className="text-theme-text-primary font-semibold">{contract.customer_name}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Veicolo:</span>
                      <p className="text-theme-text-primary font-semibold">{contract.vehicle_name}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Periodo:</span>
                      <p className="text-theme-text-primary font-semibold">
                        {new Date(contract.rental_start_date).toLocaleDateString('it-IT')} - {new Date(contract.rental_end_date).toLocaleDateString('it-IT')}
                      </p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Totale:</span>
                      <p className="text-dr7-gold font-bold">€{contract.total_amount.toFixed(2)}</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 ml-4">
                  {contract.pdf_url && (
                    <div className="flex gap-2 w-full">
                      <a
                        href={contract.pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-green-600 hover:bg-green-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors text-center flex-1 flex items-center justify-center gap-1"
                      >
                        <span>📄</span> PDF
                      </a>
                      <a
                        href={`mailto:${contract.customer_email}?subject=Contratto Noleggio ${contract.contract_number}&body=Gentile Cliente,%0D%0A%0D%0AEcco il link al tuo contratto di noleggio:%0D%0A${encodeURIComponent(contract.pdf_url)}%0D%0A%0D%0AGrazie per aver scelto DR7 Empire.`}
                        className="bg-blue-600 hover:bg-blue-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors text-center flex-1 flex items-center justify-center gap-1"
                      >
                        <span>✉️</span> Email
                      </a>
                    </div>
                  )}
                  {contract.signed_pdf_url ? (
                    <>
                      <button
                        onClick={() => window.open(contract.signed_pdf_url, '_blank')}
                        className="w-full bg-purple-600 hover:bg-purple-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                      >
                        Contratto Firmato
                      </button>
                      <button
                        onClick={() => handleSendSignatureEmail(contract)}
                        disabled={sendingSignature === contract.id}
                        className="w-full bg-dr7-gold hover:bg-[#247a6f] text-white px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1 font-bold disabled:opacity-50"
                      >
                        {sendingSignature === contract.id ? 'Invio...' : 'Reinvia Contratto'}
                      </button>
                      <button
                        onClick={() => handleViewAuditTrail(contract)}
                        className="w-full bg-gray-600 hover:bg-gray-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                      >
                        Audit Trail
                      </button>
                    </>
                  ) : contract.pdf_url ? (
                    <button
                      onClick={() => handleSendSignatureEmail(contract)}
                      disabled={sendingSignature === contract.id}
                      className="w-full bg-dr7-gold hover:bg-[#247a6f] text-white px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1 font-bold disabled:opacity-50"
                    >
                      {sendingSignature === contract.id ? 'Invio...' : 'Firma via WhatsApp'}
                    </button>
                  ) : null}
                  {contract.booking_id && (
                    <button
                      onClick={async () => {
                        try {
                          toast.loading('Rigenerazione contratto...', { id: 'regen' })
                          const res = await authFetch('/.netlify/functions/generate-contract', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ bookingId: contract.booking_id })
                          })
                          const data = await res.json().catch(() => ({}))
                          if (!res.ok) {
                            throw new Error(data.error || data.message || res.statusText)
                          }
                          toast.success('Contratto rigenerato!', { id: 'regen' })
                          if (data.url) {
                            window.open(data.url, '_blank', 'noopener,noreferrer')
                          }
                          loadContracts()
                        } catch (err: unknown) {
                          const _errMsg = err instanceof Error ? err.message : String(err)
                          toast.error('Errore: ' + _errMsg, { id: 'regen' })
                        }
                      }}
                      className="w-full bg-orange-600/30 hover:bg-orange-600/50 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                    >
                      Rigenera Contratto
                    </button>
                  )}
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={() => handleEdit(contract)}
                      className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex-1"
                    >
                      Modifica
                    </button>
                    <button
                      onClick={() => handleDelete(contract.id)}
                      className="bg-red-600 hover:bg-red-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex-1"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
