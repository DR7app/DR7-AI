import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import MechanicalBookingForm from './MechanicalBookingForm'
import NewClientModal from './NewClientModal'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildMechanicalContext } from '../../../utils/adminLogHelpers'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'
import ClientStatusBadge from '../../../components/ClientStatusBadge'

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [customerToEdit, setCustomerToEdit] = useState<any>(null)

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
      alert("Impossibile caricare i dati del cliente per la modifica.")
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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



  async function handleDelete(id: string) {
    try {
      // Try to delete from Google Calendar
      try {
        await fetch('/.netlify/functions/delete-calendar-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: id }),
        })
        logger.log('Google Calendar event deletion requested for booking:', id)
      } catch (calError) {
        logger.warn('Failed to request deletion from Google Calendar:', calError)
        // Continue with database deletion even if Google Calendar deletion fails
      }

      // Delete dependent records first (FK constraints)
      await supabase.from('contracts').delete().eq('booking_id', id)
      await supabase.from('fatture').delete().eq('booking_id', id)
      await supabase.from('cauzioni').delete().eq('riferimento_contratto_id', id)

      // Delete from database
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', id)

      if (error) throw error
      {
        const bk = bookings.find(b => b.id === id)
        logAdminAction('delete_mechanical', 'mechanical_booking', id, buildMechanicalContext(bk))
      }
      loadData()
    } catch (error) {
      console.error('Failed to delete booking:', error)
    }
  }

  const [generatingInvoice, setGeneratingInvoice] = useState(false)

  async function handleGenerateInvoice(booking: MechanicalBooking) {
    if (!booking.id) return

    // Never generate fattura for unpaid bookings
    const ps = booking.payment_status
    if (ps !== 'paid' && ps !== 'completed' && ps !== 'succeeded') {
      alert('Impossibile generare fattura: la prenotazione non è stata pagata')
      return
    }

    // Include IVA (22%) in invoice breakdown
    const includeIVA = true

    setGeneratingInvoice(true)
    try {
      const response = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, includeIVA })
      })

      const data = await response.json()
      if (!response.ok) {
        if (data.invoiceNumber) {
          alert(`⚠️ Fattura già esistente per questa prenotazione:\n\nNumero: ${data.invoiceNumber}\n\nVai alla tab "Fatture" per visualizzarla.`)
        } else {
          const errorMsg = data.message || data.error || 'Impossibile generare la fattura'
          const errorDetails = data.details ? `\n\nDettagli: ${data.details}` : ''
          const errorHint = data.hint ? `\n\nSuggerimento: ${data.hint}` : ''
          throw new Error(errorMsg + errorDetails + errorHint)
        }
        return
      }

      // Generate and open the invoice PDF
      const invoiceId = data.invoice.id
      const pdfResponse = await authFetch('/.netlify/functions/generate-invoice-pdf', {
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
          alert(`✅ Fattura generata con successo!\n\nNumero: ${data.invoice.numero_fattura}\n\nLa fattura è stata aperta in una nuova finestra.`)
        } else {
          alert(`✅ Fattura generata con successo!\n\nNumero: ${data.invoice.numero_fattura}\n\nVai alla tab "Fatture" per visualizzarla.`)
        }
      } else {
        alert(`✅ Fattura generata con successo!\n\nNumero: ${data.invoice.numero_fattura}\n\nVai alla tab "Fatture" per visualizzarla.`)
      }

      logAdminAction('generate_mechanical_fattura', 'mechanical_booking', booking.id, {
        ...buildMechanicalContext(booking),
        fattura_number: data?.invoice?.numero_fattura,
      })
      loadData()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error generating invoice:', error)
      console.error('Error generating invoice:', error)
      const errorMessage = _errMsg || ''

      // Check for validation errors (missing address/tax code)
      if (errorMessage.includes('obbligatorio') || errorMessage.includes('incomplete') || errorMessage.includes('required') || errorMessage.includes('missing')) {
        openEditCustomer(booking.customer_id)
        return
      }

      alert('Errore nella generazione della fattura:\n\n' + errorMessage)
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
          className="px-4 py-2 bg-dr7-gold hover:bg-[#247a6f] text-white font-semibold rounded-full transition-colors"
        >
          + Nuova Prenotazione
        </button>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Cerca per codice, nome, email, telefono, targa o veicolo..."
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
      <div className="rounded-lg overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead className="">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Cliente</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-secondary">Stato</th>
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

              // Search filter — normalise BOTH the query AND the haystack the
              // same way (strip spaces, hyphens, plus, parentheses) so users
              // typing "DR7-2A37CACB" match the stored "dr72a37cacb" form.
              if (!bookingSearchQuery) return true
              const norm = (s: string) => s.replace(/[\s\-\+\(\)]/g, '')
              const words = bookingSearchQuery.toLowerCase().split(/\s+/).filter(Boolean).map(norm)
              const customerName = (booking.customer_name || booking.booking_details?.customer?.fullName || '').toLowerCase()
              const customerEmail = (booking.customer_email || booking.booking_details?.customer?.email || '').toLowerCase()
              const customerPhone = (booking.customer_phone || booking.booking_details?.customer?.phone || '').toLowerCase()
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const anyBooking = booking as any
              const vehicleName = String(anyBooking.vehicle_name || '').toLowerCase()
              const vehiclePlate = String(anyBooking.vehicle_plate || '').toLowerCase()
              const bookingId = String(booking.id || '').toLowerCase()
              const bookingCode = bookingId.substring(0, 8)
              const searchText = norm(`${customerName} ${customerEmail} ${customerPhone} ${vehicleName} ${vehiclePlate} ${bookingId} ${bookingCode} dr7${bookingCode}`)
              return words.every(word => searchText.includes(word))
            }).map(booking => (
              <tr key={booking.id} className="border-t border-theme-border hover:bg-theme-bg-tertiary/50">
                <td className="px-4 py-3 text-sm text-theme-text-primary">
                  <div>{booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}</div>
                  <div className="text-theme-text-muted text-xs">{booking.customer_phone || booking.booking_details?.customer?.phone || '-'}</div>
                </td>
                <td className="px-4 py-3 text-sm">
                  <ClientStatusBadge
                    customerId={booking.customer_id}
                    email={booking.customer_email || booking.booking_details?.customer?.email}
                  />
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
                      className="px-3 py-1 min-h-[44px] bg-blue-600/30 hover:bg-blue-600/50 text-theme-text-primary text-xs rounded-full transition-colors"
                    >
                      Modifica
                    </button>
                    <button
                      onClick={() => handleGenerateInvoice(booking)}
                      disabled={generatingInvoice}
                      className={`px-3 py-1 min-h-[44px] ${generatingInvoice ? 'bg-theme-bg-hover text-theme-text-secondary' : 'bg-purple-600 hover:bg-purple-700 text-theme-text-primary'} rounded-full text-xs font-medium transition-colors disabled:opacity-50`}
                    >
                      {generatingInvoice ? '...' : 'Fattura'}
                    </button>
                    <button
                      onClick={() => handleDelete(booking.id)}
                      className="px-3 py-1 min-h-[44px] bg-red-600/30 hover:bg-red-600/50 text-theme-text-primary text-xs rounded-full transition-colors"
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


    </div>
  )
}
