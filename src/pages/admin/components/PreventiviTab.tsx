import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import PreventivoModal from './PreventivoModal'
import ConvertPreventivoModal from './ConvertPreventivoModal'
import CustomerAutocomplete from './CustomerAutocomplete'

interface Preventivo {
  id: string
  vehicle_name: string
  vehicle_plate: string
  vehicle_category: string
  fascia: string
  pickup_date: string
  dropoff_date: string
  pickup_location: string
  dropoff_location: string
  insurance_option: string
  insurance_daily: number
  rental_days: number
  daily_rate: number
  total_amount: number
  deposit_amount: number
  km_limit: number
  unlimited_km: boolean
  km_overage_fee: number
  second_driver: boolean
  no_cauzione: boolean
  delivery_enabled: boolean
  delivery_fee: number
  pickup_enabled: boolean
  pickup_fee: number
  notes: string
  customer_id: string | null
  customer_name: string | null
  status: string
  booking_id: string | null
  pdf_url: string | null
  valid_until: string
  created_at: string
  // all other fields for editing
  [key: string]: any
}

interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

export default function PreventiviTab() {
  const [preventivi, setPreventivi] = useState<Preventivo[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editData, setEditData] = useState<Preventivo | null>(null)
  const [convertData, setConvertData] = useState<Preventivo | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [assigningCustomer, setAssigningCustomer] = useState<string | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [rinviaId, setRinviaId] = useState<string | null>(null)
  const [rinviaPhone, setRinviaPhone] = useState('')
  const [rinviaSending, setRinviaSending] = useState(false)

  const loadPreventivi = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('preventivi')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('Error loading preventivi:', error)
      toast.error('Errore caricamento preventivi')
    } else {
      setPreventivi(data || [])
    }
    setLoading(false)
  }

  const loadCustomers = async () => {
    const customerMap = new Map<string, Customer>()

    // Fetch from customers_extended with pagination (service-role not needed, anon has read access)
    let from = 0
    const PAGE_SIZE = 1000
    while (true) {
      const { data, error } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, email, telefono, tipo_cliente, denominazione, ragione_sociale, scadenza_patente')
        .order('cognome')
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        console.error('[PreventiviTab] Error loading customers:', error)
        break
      }
      if (!data || data.length === 0) break

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data.forEach((c: any) => {
        let fullName = 'N/A'
        if (c.tipo_cliente === 'azienda') {
          fullName = c.denominazione || c.ragione_sociale || 'N/A'
        } else {
          fullName = `${c.nome || ''} ${c.cognome || ''}`.trim() || 'N/A'
        }
        customerMap.set(c.id, {
          id: c.id,
          full_name: fullName,
          email: c.email || null,
          phone: c.telefono || null,
        })
      })

      from += data.length
      if (data.length < PAGE_SIZE) break
    }

    console.log('[PreventiviTab] Total customers loaded:', customerMap.size)
    setCustomers(Array.from(customerMap.values()))
  }

  useEffect(() => {
    loadPreventivi()
    loadCustomers()
  }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('Eliminare questo preventivo?')) return
    const { error } = await supabase.from('preventivi').delete().eq('id', id)
    if (error) {
      toast.error('Errore eliminazione')
    } else {
      toast.success('Preventivo eliminato')
      loadPreventivi()
    }
  }

  const handleAssignCustomer = async (preventivoId: string) => {
    if (!selectedCustomerId) { toast.error('Seleziona un cliente'); return }
    const customer = customers.find(c => c.id === selectedCustomerId)
    if (!customer) return

    const { error } = await supabase.from('preventivi').update({
      customer_id: selectedCustomerId,
      customer_name: customer.full_name,
      updated_at: new Date().toISOString(),
    }).eq('id', preventivoId)

    if (error) {
      toast.error('Errore assegnazione cliente')
    } else {
      toast.success(`Cliente ${customer.full_name} assegnato!`)
      setAssigningCustomer(null)
      setSelectedCustomerId('')
      loadPreventivi()
    }
  }

  const handleRinvia = async (p: Preventivo, phone: string) => {
    if (!phone.trim()) {
      toast.error('Inserisci un numero di telefono')
      return
    }

    setRinviaSending(true)

    const pickupStr = formatDateTime(p.pickup_date)
    const dropoffStr = formatDateTime(p.dropoff_date)
    const kmInfo = p.unlimited_km ? 'Illimitati' : `${p.km_limit} Km`

    const message = `Gentile ${p.customer_name || 'Cliente'},\n\n`
      + `Le inviamo il preventivo per il noleggio richiesto:\n\n`
      + `*PREVENTIVO NOLEGGIO DR7*\n\n`
      + `*Veicolo:* ${p.vehicle_name}${p.vehicle_plate ? ` (${p.vehicle_plate})` : ''}\n`
      + `*Periodo:* ${pickupStr} → ${dropoffStr} (${p.rental_days}g)\n`
      + `*Assicurazione:* ${p.insurance_option}\n`
      + `*KM inclusi:* ${kmInfo}\n`
      + (p.second_driver ? `*Secondo guidatore:* Incluso\n` : '')
      + (p.delivery_enabled ? `*Consegna:* €${p.delivery_fee.toFixed(2)}\n` : '')
      + (p.pickup_enabled ? `*Ritiro:* €${p.pickup_fee.toFixed(2)}\n` : '')
      + `\n*Totale:* €${p.total_amount.toFixed(2)}\n`
      + (p.deposit_amount > 0 ? `*Cauzione:* €${p.deposit_amount.toFixed(0)}\n` : '')
      + (p.valid_until ? `\n⏳ Preventivo valido fino al ${formatDate(p.valid_until)}\n` : '')
      + `\nPer confermare, risponda a questo messaggio o visiti www.dr7empire.com\n`
      + `\nGrazie per averci scelto!\nDR7 Empire`

    try {
      await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPhone: phone.trim(), customMessage: message })
      })
      toast.success(`Preventivo inviato via WhatsApp!`)
      setRinviaId(null)
      setRinviaPhone('')
    } catch (err) {
      console.error('Errore invio WhatsApp:', err)
      toast.error('Errore invio WhatsApp')
    } finally {
      setRinviaSending(false)
    }
  }

  const handleDuplicate = async (p: Preventivo) => {
    const { id, created_at, updated_at, booking_id, status, pdf_url, customer_id, customer_name, ...rest } = p
    const { error } = await supabase.from('preventivi').insert({
      ...rest,
      status: 'bozza',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    if (error) {
      toast.error('Errore duplicazione')
    } else {
      toast.success('Preventivo duplicato!')
      loadPreventivi()
    }
  }

  const formatDate = (d: string) => {
    if (!d) return '-'
    const date = new Date(d)
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const formatDateTime = (d: string) => {
    if (!d) return '-'
    const date = new Date(d)
    return `${date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'bozza':
      case 'preventivo':
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">Preventivo</span>
      case 'accettato':
      case 'convertito':
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400">Convertito</span>
      case 'scaduto':
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400">Scaduto</span>
      default:
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400">{status}</span>
    }
  }

  if (loading) return <div className="text-center py-8 text-theme-text-muted">Loading...</div>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h2 className="text-xl sm:text-2xl font-light text-dr7-gold tracking-[0.3em] uppercase">Preventivi</h2>
        <Button onClick={() => { setEditData(null); setShowModal(true) }}>
          <span className="hidden sm:inline">+ Nuovo Preventivo</span>
          <span className="sm:hidden">+ Nuovo</span>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-lg border border-theme-border text-center">
          <div className="text-2xl font-bold text-blue-400">{preventivi.filter(p => (p.status === 'bozza' || p.status === 'preventivo')).length}</div>
          <div className="text-xs text-theme-text-muted">Attivi</div>
        </div>
        <div className="p-3 rounded-lg border border-theme-border text-center">
          <div className="text-2xl font-bold text-green-400">{preventivi.filter(p => (p.status === 'accettato' || p.status === 'convertito')).length}</div>
          <div className="text-xs text-theme-text-muted">Convertiti</div>
        </div>
        <div className="p-3 rounded-lg border border-theme-border text-center">
          <div className="text-2xl font-bold text-dr7-gold">€{preventivi.filter(p => (p.status === 'bozza' || p.status === 'preventivo')).reduce((s, p) => s + (p.total_amount || 0), 0).toFixed(0)}</div>
          <div className="text-xs text-theme-text-muted">Valore Attivi</div>
        </div>
      </div>

      {/* List */}
      {preventivi.length === 0 ? (
        <div className="rounded-lg border border-theme-border/30 p-8 text-center text-theme-text-muted">
          Nessun preventivo. Clicca "+ Nuovo Preventivo" per crearne uno.
        </div>
      ) : (
        <div className="space-y-3">
          {preventivi.map(p => (
            <div key={p.id} className={`rounded-lg border p-4 ${(p.status === 'accettato' || p.status === 'convertito') ? 'border-green-600/30 bg-green-900/10' : 'border-theme-border'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Left: main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getStatusBadge(p.status)}
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${p.fascia === 'A' ? 'bg-green-600/20 text-green-400' : 'bg-orange-600/20 text-orange-400'}`}>
                      Fascia {p.fascia}
                    </span>
                    <span className="text-theme-text-primary font-semibold">{p.vehicle_name}</span>
                    {p.vehicle_plate && <span className="text-theme-text-muted text-sm">({p.vehicle_plate})</span>}
                  </div>
                  <div className="text-sm text-theme-text-muted mt-1">
                    {formatDateTime(p.pickup_date)} → {formatDateTime(p.dropoff_date)}
                    <span className="ml-2">({p.rental_days}g)</span>
                    <span className="mx-2">•</span>
                    {p.insurance_option}
                    {p.unlimited_km && <span className="ml-2 text-blue-400">KM Illimitati</span>}
                    {p.second_driver && <span className="ml-2 text-purple-400">+2° Guidatore</span>}
                  </div>
                  {p.customer_name && (
                    <div className="text-sm text-green-400 mt-1">
                      Cliente: <span className="font-medium">{p.customer_name}</span>
                    </div>
                  )}
                  {p.notes && <div className="text-xs text-theme-text-muted mt-1 italic">{p.notes}</div>}
                  <div className="text-xs text-theme-text-muted mt-1">
                    Creato: {formatDate(p.created_at)}
                    {p.valid_until && <span className="ml-2">• Valido fino: {formatDate(p.valid_until)}</span>}
                  </div>
                </div>

                {/* Right: price + actions */}
                <div className="flex flex-col items-end gap-2">
                  <div className="text-xl font-bold text-dr7-gold">€{(p.total_amount || 0).toFixed(2)}</div>
                  {p.deposit_amount > 0 && (
                    <div className="text-xs text-theme-text-muted">Cauzione: €{p.deposit_amount.toFixed(0)}</div>
                  )}
                  <div className="flex gap-2 flex-wrap justify-end">
                    {(p.status === 'bozza' || p.status === 'preventivo') && (
                      <>
                        {/* Assign customer */}
                        {!p.customer_id && (
                          <button
                            onClick={() => { setAssigningCustomer(assigningCustomer === p.id ? null : p.id); setSelectedCustomerId('') }}
                            className="px-3 py-1.5 text-xs rounded-full bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 transition-colors"
                          >
                            Assegna Cliente
                          </button>
                        )}
                        {/* Convert to booking */}
                        <button
                          onClick={() => setConvertData(p)}
                          className="px-3 py-1.5 text-xs rounded-full bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors"
                        >
                          Converti in Prenotazione
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => { setEditData(p); setShowModal(true) }}
                          className="px-3 py-1.5 text-xs rounded-full bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary transition-colors"
                        >
                          Modifica
                        </button>
                        {/* Rinvia via WhatsApp */}
                        <button
                          onClick={() => {
                            const customer = customers.find(c => c.id === p.customer_id)
                            setRinviaId(rinviaId === p.id ? null : p.id)
                            setRinviaPhone(customer?.phone || '')
                          }}
                          className="px-3 py-1.5 text-xs rounded-full bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors"
                        >
                          Rinvia
                        </button>
                      </>
                    )}
                    {/* Duplicate */}
                    <button
                      onClick={() => handleDuplicate(p)}
                      className="px-3 py-1.5 text-xs rounded-full bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary transition-colors"
                    >
                      Duplica
                    </button>
                    {/* Delete */}
                    {p.status !== 'convertito' && (
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="px-3 py-1.5 text-xs rounded-full bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                      >
                        Elimina
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Assign customer inline */}
              {assigningCustomer === p.id && (
                <div className="mt-3 p-3 rounded-lg border border-purple-500/30 bg-purple-900/10">
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cerca Cliente</label>
                  <CustomerAutocomplete
                    customers={customers}
                    selectedCustomerId={selectedCustomerId}
                    onSelectCustomer={(id) => setSelectedCustomerId(id)}
                    placeholder="Nome, email o telefono..."
                    required={false}
                  />
                  <div className="flex gap-2 mt-2">
                    <Button onClick={() => handleAssignCustomer(p.id)} className="text-xs">Assegna</Button>
                    <Button variant="secondary" onClick={() => setAssigningCustomer(null)} className="text-xs">Annulla</Button>
                  </div>
                </div>
              )}

              {/* Rinvia WhatsApp inline */}
              {rinviaId === p.id && (
                <div className="mt-3 p-3 rounded-lg border border-green-500/30 bg-green-900/10">
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">Invia Preventivo via WhatsApp</label>
                  <input
                    type="tel"
                    value={rinviaPhone}
                    onChange={(e) => setRinviaPhone(e.target.value)}
                    placeholder="Numero telefono (es. +39 333 1234567)"
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <div className="flex gap-2 mt-2">
                    <Button onClick={() => handleRinvia(p, rinviaPhone)} className="text-xs bg-green-600 hover:bg-green-700" disabled={rinviaSending}>
                      {rinviaSending ? 'Invio...' : 'Invia WhatsApp'}
                    </Button>
                    <Button variant="secondary" onClick={() => { setRinviaId(null); setRinviaPhone('') }} className="text-xs">Annulla</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Preventivo Modal */}
      <PreventivoModal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditData(null) }}
        onSaved={loadPreventivi}
        editData={editData}
      />

      {/* Convert to Booking Modal */}
      {convertData && (
        <ConvertPreventivoModal
          isOpen={!!convertData}
          preventivo={convertData}
          customers={customers}
          onClose={() => setConvertData(null)}
          onConverted={() => { setConvertData(null); loadPreventivi() }}
        />
      )}
    </div>
  )
}
