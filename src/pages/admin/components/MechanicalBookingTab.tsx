import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import MechanicalBookingForm from './MechanicalBookingForm'
import NewClientModal from './NewClientModal'

interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

interface MechanicalBooking {
  id: string
  customer_id: string
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_codice_fiscale?: string
  customer_indirizzo?: string
  customer_numero_civico?: string
  customer_citta?: string
  customer_cap?: string
  customer_provincia?: string
  service_name: string
  vehicle_info: string // Customer's vehicle info
  appointment_date: string
  appointment_time: string
  price_total: number
  status: string
  payment_status: string
  payment_method?: string
  booking_details: any
  created_at: string
}



export default function MechanicalBookingTab() {
  const [bookings, setBookings] = useState<MechanicalBooking[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Quick Edit Customer Modal State
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [customerToEdit, setCustomerToEdit] = useState<any>(null)

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  async function openEditCustomer(customerId: string) {
    if (!customerId) return
    try {
      const { data, error } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('id', customerId)
        .single()

      if (error) throw error
      if (data) {
        setCustomerToEdit(data)
        setEditModalOpen(true)
      }
    } catch (error) {
      console.error('Error fetching customer for edit:', error)
      toast.error("Impossibile caricare i dati del cliente per la modifica.")
    }
  }


  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Load customers from customers_extended (includes all customers from all sources)
      const { data: customersData, error: customersError } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, ragione_sociale, email, telefono')
        .order('cognome')

      if (customersError) throw customersError

      // Map customers_extended to Customer interface
      const mappedCustomers: Customer[] = (customersData || []).map((c: any) => ({
        id: c.id,
        full_name: c.ragione_sociale || `${c.nome || ''} ${c.cognome || ''}`.trim(),
        email: c.email,
        phone: c.telefono
      }))

      setCustomers(mappedCustomers)

      // Load mechanical service bookings (include both 'mechanical_service' and 'mechanical')
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .or('service_type.eq.mechanical_service,service_type.eq.mechanical')
        .order('appointment_date', { ascending: false })

      if (bookingsError) throw bookingsError
      setBookings(bookingsData || [])
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }



  function handleDelete(id: string, name: string) {
    setDeleteTarget({ id, name })
  }

  async function confirmDelete() {
    if (!deleteTarget) return

    try {
      // Try to delete from Google Calendar
      try {
        await fetch('/.netlify/functions/delete-calendar-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: deleteTarget.id }),
        })
        console.log('Google Calendar event deletion requested for booking:', deleteTarget.id)
      } catch (calError) {
        console.warn('Failed to request deletion from Google Calendar:', calError)
        // Continue with database deletion even if Google Calendar deletion fails
      }

      // Delete from database
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', deleteTarget.id)

      if (error) throw error
      toast.success('Prenotazione eliminata')
      setDeleteTarget(null)
      loadData()
    } catch (error) {
      console.error('Failed to delete booking:', error)
      toast.error('Errore durante l\'eliminazione')
      setDeleteTarget(null)
    }
  }

  const [generatingInvoice, setGeneratingInvoice] = useState(false)

  async function handleGenerateInvoice(booking: MechanicalBooking) {
    if (!booking.id) return

    // Include IVA (22%) in invoice breakdown
    const includeIVA = true

    setGeneratingInvoice(true)
    try {
      const response = await fetch('/.netlify/functions/generate-invoice-from-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, includeIVA })
      })

      const data = await response.json()
      if (!response.ok) {
        if (data.invoiceNumber) {
          toast.error(`Fattura già esistente per questa prenotazione (Numero: ${data.invoiceNumber}). Vai alla tab "Fatture" per visualizzarla.`)
        } else {
          const errorMsg = data.message || data.error || 'Impossibile generare la fattura'
          const errorDetails = data.details ? ` - Dettagli: ${data.details}` : ''
          const errorHint = data.hint ? ` - Suggerimento: ${data.hint}` : ''
          throw new Error(errorMsg + errorDetails + errorHint)
        }
        return
      }

      // Generate and open the invoice PDF
      const invoiceId = data.invoice.id
      const pdfResponse = await fetch('/.netlify/functions/generate-invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId })
      })

      if (pdfResponse.ok) {
        const html = await pdfResponse.text()
        const blob = new Blob([html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        const printWindow = window.open(url, '_blank')

        if (printWindow) {
          // Increase timeout to ensure browser has time to load the Blob URL
          setTimeout(() => URL.revokeObjectURL(url), 3000)
          toast.success(`Fattura generata con successo (Numero: ${data.invoice.numero_fattura}). Aperta in una nuova finestra.`)
        } else {
          toast.success(`Fattura generata con successo (Numero: ${data.invoice.numero_fattura}). Vai alla tab "Fatture" per visualizzarla.`)
        }
      } else {
        toast.success(`Fattura generata con successo (Numero: ${data.invoice.numero_fattura}). Vai alla tab "Fatture" per visualizzarla.`)
      }

      loadData()
    } catch (error: any) {
      console.error('Error generating invoice:', error)
      console.error('Error generating invoice:', error)
      const errorMessage = error.message || ''

      // Check for validation errors (missing address/tax code)
      if (errorMessage.includes('obbligatorio') || errorMessage.includes('incomplete') || errorMessage.includes('required') || errorMessage.includes('missing')) {
        openEditCustomer(booking.customer_id)
          return
      }

      toast.error('Errore nella generazione della fattura: ' + errorMessage)
    } finally {
      setGeneratingInvoice(false)
    }
  }

  // State for search query
  const [bookingSearchQuery, setBookingSearchQuery] = useState('')

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl sm:text-2xl font-light text-dr7-gold tracking-[0.3em] uppercase">Meccanica</h2>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-dr7-gold hover:bg-yellow-500 text-black font-semibold rounded-full transition-colors"
        >
          + Nuova Prenotazione
        </button>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Cerca prenotazione per nome cliente..."
          value={bookingSearchQuery}
          onChange={(e) => setBookingSearchQuery(e.target.value)}
          className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold"
        />
      </div>


      {/* Booking Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <MechanicalBookingForm
              initialData={editingId ? bookings.find(b => b.id === editingId) : undefined}
              editingId={editingId}
              customers={customers}
              onSave={() => {
                setShowForm(false)
                setEditingId(null)
                loadData()
              }}
              onCancel={() => {
                setShowForm(false)
                setEditingId(null)
              }}
            />
          </div>
        </div>
      )}

      {/* Quick Edit Customer Modal */}
      <NewClientModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        initialData={customerToEdit}
        onClientCreated={() => {
          loadData() // Refresh booking data to reflect customer updates (though join might need refetch)
          // We don't automatically retry invoice generation, user can click again
        }}
      />

      {/* Bookings Table */}
      <div className="rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Cliente</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Veicolo</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Servizio</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Appuntamento</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Prezzo</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Pagamento</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {bookings.filter(booking => {

              // Search filter
              if (!bookingSearchQuery) return true
              const query = bookingSearchQuery.toLowerCase()
              const customerName = (booking.customer_name || '').toLowerCase()
              return customerName.includes(query)
            }).map(booking => (
              <tr key={booking.id} className="border-t border-theme-border hover:bg-theme-bg-tertiary/50">
                <td className="px-4 py-3 text-sm text-theme-text-primary">
                  <div>{booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}</div>
                  <div className="text-theme-text-muted text-xs">{booking.customer_phone || booking.booking_details?.customer?.phone || '-'}</div>
                </td>
                <td className="px-4 py-3 text-sm text-theme-text-primary">
                  {booking.booking_details?.vehicleInfo || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-theme-text-primary">
                  {booking.service_name}
                </td>
                <td className="px-4 py-3 text-sm text-theme-text-primary">
                  <div>
                    {booking.appointment_date && new Date(booking.appointment_date).toLocaleDateString('it-IT', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    })}
                  </div>
                  <div className="text-dr7-gold">{booking.appointment_time}</div>
                </td>
                <td className="px-4 py-3 text-sm text-theme-text-primary">
                  €{(booking.price_total / 100).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                    }`}>
                    {booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded' ? 'Pagato' : 'Non Pagato'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingId(booking.id)
                        setShowForm(true)
                      }}
                      className="px-3 py-1 bg-blue-600/30 hover:bg-blue-600/50 text-theme-text-primary text-xs rounded-full transition-colors"
                    >
                      Modifica
                    </button>
                    <button
                      onClick={() => handleGenerateInvoice(booking)}
                      disabled={generatingInvoice}
                      className={`px-3 py-1 ${generatingInvoice ? 'bg-theme-bg-hover text-theme-text-secondary' : 'bg-purple-600 hover:bg-purple-700 text-theme-text-primary'} rounded-full text-xs font-medium transition-colors disabled:opacity-50`}
                    >
                      {generatingInvoice ? '...' : 'Fattura'}
                    </button>
                    <button
                      onClick={() => handleDelete(booking.id, booking.customer_name)}
                      className="px-3 py-1 bg-red-600/30 hover:bg-red-600/50 text-theme-text-primary text-xs rounded-full transition-colors"
                    >
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {bookings.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-theme-text-muted">
                  Nessuna prenotazione trovata
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Conferma eliminazione</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Sei sicuro di voler eliminare la prenotazione di <strong>{deleteTarget.name}</strong>? Questa azione non può essere annullata.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                Annulla
              </button>
              <button onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
